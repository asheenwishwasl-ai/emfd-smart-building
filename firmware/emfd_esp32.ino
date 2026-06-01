/* =====================================================================
 *  EMFD - Energy Monitoring & Fault Detection (ESP32)
 *  Corrected & hardened firmware
 *
 *  Key fixes vs. original:
 *   - Stable RMS using a FIXED-TIME 100 ms window (= 5 cycles @50Hz /
 *     6 cycles @60Hz) instead of a fixed sample count -> removes the
 *     voltage & current fluctuation.
 *   - Persistent, slowly-adapting DC offset (clean RMS + drift proof).
 *   - Light EMA smoothing on the displayed V / I for a steady reading.
 *   - DHT22 read every 2.5 s (sensor needs >=2 s between reads).
 *   - Energy integrated with REAL elapsed time.
 *   - HTTP timeouts + WiFi auto-reconnect (won't freeze the alarm).
 *   - Units shown on every LCD screen and added to the JSON payload.
 *
 *  [NEW] Feature 1 — Monthly kWh & CEB Bill Calculation:
 *   - Preferences.h / NVS namespace "billing" persists monthly_kWh.
 *   - calculateCEBBill()  — Sri Lanka CEB Domestic D1 progressive tariff
 *     (PUCSL approved rates effective April 1, 2026).
 *   - updateBilling()     — non-blocking accumulator called each tick.
 *   - saveToNVS()         — auto-saves every 5 min to limit flash wear.
 *   - GPIO 32 reset button with IRAM_ATTR ISR + g_resetFlag consumed
 *     safely inside updateBilling().
 *   - sendToServer() adds monthly_kwh + monthly_bill_lkr to JSON and
 *     parses the HTTP response for a remote "reset_billing" command.
 *   - LCD Screen 4 shows current Units & estimated Bill.
 * ===================================================================== */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Preferences.h>

// ================= WIFI =================
const char* ssid     = "SKS 2.5";
const char* password = "D4803B5A";

// ================= SERVER =================
// After Vercel deployment replace with:
//   const char* SERVER_URL = "https://your-app.vercel.app/api/sensor-data";
const char* SERVER_URL = "http://192.168.8.123:3000/api/sensor-data";
const char* DEVICE_ID  = "building-01";
const char* API_KEY    = "esp32-secret-key-2026";

// ================= PINS =================
#define VOLTAGE_PIN    35
#define CURRENT_PIN    34
#define FLAME_PIN      27
#define DHT_PIN        26
#define BUZZER_PIN     25
#define RESET_BTN_PIN  32   // [NEW] Billing reset button — INPUT_PULLUP, FALLING edge

// ================= LCD =================
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ================= DHT =================
#define DHT_TYPE DHT22
DHT dht(DHT_PIN, DHT_TYPE);

// ================= ADC =================
#define ADC_RESOLUTION 4095.0
#define ADC_REF        3.3

// ================= ACS712 =================
#define ACS_SENSITIVITY 0.044

// ================= CALIBRATION =================
#define VOLTAGE_CALIBRATION 492

// ================= THRESHOLDS =================
#define VOLTAGE_NOISE_THRESHOLD  80.0
#define CURRENT_NOISE_THRESHOLD  0.15
#define TEMP_FAULT_THRESHOLD     55.0

// ================= SAMPLING =================
// 100 ms window = 5 full cycles @50Hz (6 @60Hz) -> integer cycles -> stable RMS
#define RMS_WINDOW_US   100000UL
// Smoothing of the displayed reading (0..1). Higher = steadier but slower.
#define DISPLAY_SMOOTH  0.70f
// How fast the DC offset adapts between windows (0..1). Small = stable.
#define OFFSET_ADAPT    0.10f

// ================= STRUCT =================
struct FaultData
{
  bool  flameDetected;
  float temperature;
  float humidity;
  bool  tempFault;
  bool  dhtFailed;
};

// ================= GLOBALS =================
float energy_kWh = 0;
float g_voltage  = 0;
float g_current  = 0;
float g_power    = 0;

FaultData g_fault = {false, 0, 0, false, true};

// ================= BILLING (NVS persisted) =================
float       monthly_kWh      = 0.0f;   // accumulated this calendar month
float       monthly_bill_lkr = 0.0f;   // estimated CEB bill (LKR)
Preferences billingPrefs;              // NVS handle

// ================= RESET BUTTON ISR =================
// GPIO 32 FALLING edge sets this flag; consumed non-blocking in updateBilling().
volatile bool g_resetFlag = false;

void IRAM_ATTR onResetBtn() { g_resetFlag = true; }

// ================= TIMING =================
unsigned long lastSensorMillis  = 0;
unsigned long lastLCDMillis     = 0;
unsigned long lastDHTMillis     = 0;
unsigned long lastEnergyMillis  = 0;
unsigned long lastWifiTry       = 0;
unsigned long lastNVSSaveMillis = 0;   // [NEW] NVS auto-save interval

const long         sensorInterval  = 1000;      // power read + upload (ms)
const long         lcdInterval     = 1000;      // LCD page rotation (ms)
const long         dhtInterval     = 2500;      // DHT22 minimum 2 s (ms)
const long         wifiRetryMs     = 5000;      // WiFi reconnect spacing (ms)
const unsigned long nvsSaveInterval = 300000UL; // NVS save every 5 minutes

// ================= LCD SCREEN =================
int lcdScreen = 0;   // 0-4, now 5 screens

// ================= DC OFFSETS (in ADC counts) =================
float voltageOffset = 0;
float currentOffset = 0;

// =====================================================
// BUZZER (active LOW)
// =====================================================
void buzzerON()  { digitalWrite(BUZZER_PIN, LOW);  }
void buzzerOFF() { digitalWrite(BUZZER_PIN, HIGH); }

// =====================================================
// FAST BUZZER / FLAME UPDATE
//  - Reads the flame pin directly for instant response.
//  - Also keeps g_fault.flameDetected fresh for the LCD.
//  - Alarms on flame OR over-temperature fault.
// =====================================================
void updateBuzzer()
{
  bool flameNow = (digitalRead(FLAME_PIN) == LOW); // LOW = flame
  g_fault.flameDetected = flameNow;

  if (flameNow || g_fault.tempFault)
    buzzerON();
  else
    buzzerOFF();
}

// =====================================================
// CEB DOMESTIC D1 TIERED TARIFF  (Effective April 1, 2026)
//  Source: PUCSL approved End-User Tariff schedule.
//
//  Two consumer categories (total monthly usage determines which applies):
//
//  LOW USERS (total ≤ 60 kWh)      — block-progressive, lower rates
//  ─────────────────────────────────────────────────────────────────
//   0 – 30 kWh  :  Rs.  5.00/kWh  Fixed: Rs.   80/month
//  31 – 60 kWh  :  Rs.  9.00/kWh  Fixed: Rs.  210/month
//
//  DOMESTIC USERS (total > 60 kWh) — ALL units re-rated at higher blocks
//  ─────────────────────────────────────────────────────────────────
//   0 – 60 kWh  :  Rs. 14.00/kWh
//  61 – 90 kWh  :  Rs. 20.00/kWh  Fixed: Rs.  400/month
//  91 – 120 kWh :  Rs. 28.00/kWh  Fixed: Rs. 1000/month
// 121 – 180 kWh :  Rs. 44.00/kWh  Fixed: Rs. 1500/month
//   > 180 kWh   :  Rs. 85.00/kWh  Fixed: Rs. 2100/month
// =====================================================
float calculateCEBBill(float kWh)
{
  if (kWh <= 0.0f) return 0.0f;

  float energy = 0.0f;
  float fixed  = 0.0f;

  if (kWh <= 30.0f)
  {
    energy = kWh * 5.00f;
    fixed  = 80.0f;
  }
  else if (kWh <= 60.0f)
  {
    energy = 30.0f * 5.00f + (kWh - 30.0f) * 9.00f;
    fixed  = 210.0f;
  }
  else if (kWh <= 90.0f)
  {
    // > 60 kWh: ALL units re-rated at domestic-user block rates
    energy = 60.0f * 14.00f + (kWh - 60.0f) * 20.00f;
    fixed  = 400.0f;
  }
  else if (kWh <= 120.0f)
  {
    energy = 60.0f * 14.00f + 30.0f * 20.00f + (kWh - 90.0f) * 28.00f;
    fixed  = 1000.0f;
  }
  else if (kWh <= 180.0f)
  {
    energy = 60.0f * 14.00f + 30.0f * 20.00f + 30.0f * 28.00f
           + (kWh - 120.0f) * 44.00f;
    fixed  = 1500.0f;
  }
  else
  {
    energy = 60.0f * 14.00f + 30.0f * 20.00f + 30.0f * 28.00f
           + 60.0f * 44.00f + (kWh - 180.0f) * 85.00f;
    fixed  = 2100.0f;
  }

  return energy + fixed;
}

// =====================================================
// SAVE BILLING STATE TO NVS FLASH
//  Namespace "billing" — called on every reset AND every 5 minutes
//  automatically to prevent data loss across power cycles.
// =====================================================
void saveToNVS()
{
  billingPrefs.begin("billing", false);   // false = read-write mode
  billingPrefs.putFloat("monthly_kwh", monthly_kWh);
  billingPrefs.end();
  Serial.println("[NVS] Billing saved.");
}

// =====================================================
// BILLING RESET  (physical button OR remote dashboard command)
//  • Identical behaviour for both reset sources.
//  • Zeroes counters → saves NVS → emits 3 short beeps.
// =====================================================
void resetBilling()
{
  monthly_kWh      = 0.0f;
  monthly_bill_lkr = 0.0f;
  saveToNVS();
  Serial.println("[BILLING] Reset — monthly_kWh = 0");

  // 3 short confirmation beeps (blocking delay is acceptable here —
  // this is an infrequent, intentional user-triggered action).
  for (int i = 0; i < 3; i++) {
    buzzerON();  delay(120);
    buzzerOFF(); delay(120);
  }
}

// =====================================================
// NON-BLOCKING BILLING ACCUMULATION
//  Called every sensorInterval with the instantaneous watt reading
//  and the real elapsed seconds (dtSec) for that interval.
//
//  Responsibilities:
//   1. Consume the physical button ISR flag (g_resetFlag).
//   2. Accumulate monthly energy in kWh.
//   3. Recalculate the estimated CEB bill.
//   4. Auto-save to NVS every 5 minutes (wear protection).
// =====================================================
void updateBilling(float watt, float dtSec)
{
  // -- (1) Physical button: safely consume ISR flag outside interrupt context --
  if (g_resetFlag) {
    g_resetFlag = false;
    resetBilling();
    return;
  }

  // -- (2) Integrate monthly energy (W·s → kWh : divide by 3 600 000) --
  if (dtSec > 0.0f && dtSec < 5.0f)
    monthly_kWh += (watt * dtSec) / 3600000.0f;

  // -- (3) Update estimated bill --
  monthly_bill_lkr = calculateCEBBill(monthly_kWh);

  // -- (4) Auto-save every 5 minutes --
  unsigned long nowMs = millis();
  if (nowMs - lastNVSSaveMillis >= nvsSaveInterval) {
    lastNVSSaveMillis = nowMs;
    saveToNVS();
  }
}

// =====================================================
// CALIBRATION  (sets the zero-signal DC offset)
// =====================================================
void calibrateSensors()
{
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Calibrating...");
  lcd.setCursor(0, 1); lcd.print("Turn OFF mains");
  delay(2000);

  double voltageSum = 0;
  double currentSum = 0;
  const int samples = 1000;

  for (int i = 0; i < samples; i++)
  {
    updateBuzzer();
    voltageSum += analogRead(VOLTAGE_PIN);
    currentSum += analogRead(CURRENT_PIN);
    delay(1);
  }

  voltageOffset = voltageSum / (double)samples;
  currentOffset = currentSum / (double)samples;

  Serial.print("Voltage Offset: "); Serial.println(voltageOffset);
  Serial.print("Current Offset: "); Serial.println(currentOffset);

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Calibration OK");
  delay(1000);
}

// =====================================================
// SAMPLE V & I TOGETHER OVER ONE FIXED-TIME WINDOW
//  This is the core fix: integrating RMS over whole mains
//  cycles eliminates the per-reading fluctuation.
// =====================================================
void sampleVI(float &vrms, float &irms)
{
  double sumSqV = 0.0, sumSqI = 0.0;   // for RMS
  double sumV   = 0.0, sumI   = 0.0;   // for offset adaptation
  unsigned long n = 0;

  // Offset is held CONSTANT within the window (clean RMS),
  // then adapted slowly afterwards to track long-term drift.
  const float offV = voltageOffset;
  const float offI = currentOffset;

  unsigned long startUs = micros();
  while ((unsigned long)(micros() - startUs) < RMS_WINDOW_US)
  {
    int rawV = analogRead(VOLTAGE_PIN);
    int rawI = analogRead(CURRENT_PIN);

    float cV = (float)rawV - offV;
    float cI = (float)rawI - offI;

    sumSqV += (double)cV * cV;
    sumSqI += (double)cI * cI;
    sumV   += rawV;
    sumI   += rawI;
    n++;

    // Fixed-time window tolerates this tiny jitter, so we can keep
    // the flame alarm fully responsive even while sampling.
    updateBuzzer();
  }

  if (n == 0) { vrms = 0; irms = 0; return; }

  // Adapt DC offsets slowly (between windows only)
  float meanV = (float)(sumV / (double)n);
  float meanI = (float)(sumI / (double)n);
  voltageOffset += (meanV - voltageOffset) * OFFSET_ADAPT;
  currentOffset += (meanI - currentOffset) * OFFSET_ADAPT;

  // RMS in ADC counts -> volts at the pin -> real-world units
  float vCounts = sqrt(sumSqV / (double)n);
  float iCounts = sqrt(sumSqI / (double)n);

  vrms = vCounts * (ADC_REF / ADC_RESOLUTION) * VOLTAGE_CALIBRATION;
  irms = (iCounts * (ADC_REF / ADC_RESOLUTION)) / ACS_SENSITIVITY;

  if (vrms < VOLTAGE_NOISE_THRESHOLD) vrms = 0;
  if (irms < CURRENT_NOISE_THRESHOLD) irms = 0;
}

// =====================================================
// READ DHT22  (called at >= 2 s spacing)
// =====================================================
void readDHT()
{
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t))
  {
    g_fault.dhtFailed   = true;
    g_fault.temperature = -999;
    g_fault.humidity    = -999;
    g_fault.tempFault   = false;
  }
  else
  {
    g_fault.dhtFailed   = false;
    g_fault.temperature = t;
    g_fault.humidity    = h;
    g_fault.tempFault   = (t >= TEMP_FAULT_THRESHOLD);
  }
}

// =====================================================
// LCD UPDATE  (units shown on every page)
//  5 screens: 0=V/I  1=P/E  2=Temp/Hum  3=WiFi  4=Bill
// =====================================================
void updateLCD()
{
  lcd.clear();

  // ===== FLAME (highest priority — overrides all screens) =====
  if (g_fault.flameDetected)
  {
    lcd.setCursor(0, 0); lcd.print("!! FLAME !!");
    lcd.setCursor(0, 1); lcd.print("CHECK SYSTEM");
    return;
  }

  // ===== HIGH TEMP =====
  if (g_fault.tempFault)
  {
    lcd.setCursor(0, 0); lcd.print("HIGH TEMP!");
    lcd.setCursor(0, 1);
    lcd.print(g_fault.temperature, 1);
    lcd.print((char)223); lcd.print("C");
    return;
  }

  // ===== SCREEN 0 : Voltage / Current =====
  if (lcdScreen == 0)
  {
    lcd.setCursor(0, 0);
    lcd.print("V: "); lcd.print(g_voltage, 1); lcd.print(" V");
    lcd.setCursor(0, 1);
    lcd.print("I: "); lcd.print(g_current, 2); lcd.print(" A");
  }

  // ===== SCREEN 1 : Power / Energy =====
  else if (lcdScreen == 1)
  {
    lcd.setCursor(0, 0);
    lcd.print("P: "); lcd.print(g_power, 1); lcd.print(" W");
    lcd.setCursor(0, 1);
    lcd.print("E: "); lcd.print(energy_kWh, 4); lcd.print(" kWh");
  }

  // ===== SCREEN 2 : Temp / Humidity =====
  else if (lcdScreen == 2)
  {
    if (g_fault.dhtFailed)
    {
      lcd.setCursor(0, 0); lcd.print("DHT ERROR");
    }
    else
    {
      lcd.setCursor(0, 0);
      lcd.print("T: "); lcd.print(g_fault.temperature, 1);
      lcd.print((char)223); lcd.print("C");
      lcd.setCursor(0, 1);
      lcd.print("H: "); lcd.print(g_fault.humidity, 1); lcd.print(" %");
    }
  }

  // ===== SCREEN 3 : WiFi =====
  else if (lcdScreen == 3)
  {
    lcd.setCursor(0, 0);
    if (WiFi.status() == WL_CONNECTED)
    {
      lcd.print("WiFi Connected");
      lcd.setCursor(0, 1);
      lcd.print(WiFi.localIP().toString());
    }
    else
    {
      lcd.print("WiFi Lost");
      lcd.setCursor(0, 1);
      lcd.print("Reconnecting...");
    }
  }

  // ===== SCREEN 4 : Monthly Units & Estimated Bill [NEW] =====
  else if (lcdScreen == 4)
  {
    lcd.setCursor(0, 0);
    lcd.print("Unit:"); lcd.print(monthly_kWh, 3); lcd.print("kWh");
    lcd.setCursor(0, 1);
    lcd.print("Bill:Rs"); lcd.print(monthly_bill_lkr, 0);
  }
}

// =====================================================
// SEND DATA TO SERVER
//  [MOD] Adds monthly_kwh + monthly_bill_lkr to JSON payload.
//  [NEW] Parses HTTP response body — if reset_billing:true,
//        calls resetBilling() (identical behaviour to physical button).
// =====================================================
void sendToServer()
{
  if (WiFi.status() != WL_CONNECTED) return;

  StaticJsonDocument<1024> doc;

  doc["device_id"]         = DEVICE_ID;
  doc["voltage"]           = g_voltage;
  doc["current"]           = g_current;
  doc["power"]             = g_power;
  doc["energy_kwh"]        = energy_kWh;
  doc["temperature"]       = g_fault.temperature;
  doc["humidity"]          = g_fault.humidity;
  doc["flame_detected"]    = g_fault.flameDetected;
  doc["temp_fault"]        = g_fault.tempFault;
  doc["dht_error"]         = g_fault.dhtFailed;
  doc["monthly_kwh"]       = monthly_kWh;       // [NEW]
  doc["monthly_bill_lkr"]  = monthly_bill_lkr;  // [NEW]

  // Units so the dashboard can render them next to each value
  JsonObject units = doc.createNestedObject("units");
  units["voltage"]         = "V";
  units["current"]         = "A";
  units["power"]           = "W";
  units["energy_kwh"]      = "kWh";
  units["temperature"]     = "\u00B0C";   // °C
  units["humidity"]        = "%";
  units["monthly_kwh"]     = "kWh";
  units["monthly_bill_lkr"] = "LKR";

  String json;
  serializeJson(doc, json);

  WiFiClient client;
  HTTPClient http;

  http.begin(client, SERVER_URL);
  http.setConnectTimeout(1500);   // don't hang on a dead server
  http.setTimeout(1500);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);

  int responseCode = http.POST(json);
  Serial.print("HTTP Response: ");
  Serial.println(responseCode);

  // [NEW] Parse server response — check for remote billing reset command
  if (responseCode > 0)
  {
    String responseBody = http.getString();
    StaticJsonDocument<256> resp;
    DeserializationError err = deserializeJson(resp, responseBody);
    if (!err && (resp["reset_billing"] | false))
    {
      Serial.println("[SERVER] Remote billing reset commanded — zeroing monthly_kWh.");
      resetBilling();
    }
  }

  http.end();
}

// =====================================================
// SETUP
// =====================================================
void setup()
{
  Serial.begin(115200);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  pinMode(FLAME_PIN,     INPUT_PULLUP);
  pinMode(BUZZER_PIN,    OUTPUT);
  buzzerOFF();

  // ===== [NEW] RESET BUTTON GPIO 32 =====
  pinMode(RESET_BTN_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(RESET_BTN_PIN), onResetBtn, FALLING);

  dht.begin();

  lcd.begin();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("EMFD System");
  lcd.setCursor(0, 1); lcd.print("Starting...");
  delay(1000);

  // ===== [NEW] LOAD MONTHLY BILLING DATA FROM NVS =====
  billingPrefs.begin("billing", true);   // true = read-only
  monthly_kWh = billingPrefs.getFloat("monthly_kwh", 0.0f);
  billingPrefs.end();
  monthly_bill_lkr = calculateCEBBill(monthly_kWh);
  Serial.print("[NVS] Loaded monthly_kWh = ");
  Serial.println(monthly_kWh, 4);

  calibrateSensors();

  // ===== WIFI =====
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Connecting WiFi");

  int wifiTimeout = 0;
  while (WiFi.status() != WL_CONNECTED && wifiTimeout < 20)
  {
    updateBuzzer();
    delay(250);
    Serial.print(".");
    wifiTimeout++;
  }

  lcd.clear();
  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("\nWiFi Connected");
    lcd.setCursor(0, 0); lcd.print("WiFi Connected");
    lcd.setCursor(0, 1); lcd.print(WiFi.localIP().toString());
  }
  else
  {
    Serial.println("\nWiFi Failed");
    lcd.setCursor(0, 0); lcd.print("WiFi Failed");
  }
  delay(1000);

  // Prime the DHT and the display
  readDHT();
  updateLCD();

  unsigned long t  = millis();
  lastLCDMillis    = t;
  lastSensorMillis = t;
  lastDHTMillis    = t;
  lastEnergyMillis = t;
  lastNVSSaveMillis = t;   // [NEW] Seed NVS auto-save timer
}

// =====================================================
// LOOP
// =====================================================
void loop()
{
  updateBuzzer();                 // fast flame / fault response
  unsigned long now = millis();

  // ---- WiFi keep-alive (non-blocking) ----
  if (WiFi.status() != WL_CONNECTED && (now - lastWifiTry >= wifiRetryMs))
  {
    lastWifiTry = now;
    WiFi.reconnect();
  }

  // ---- DHT22 (>= 2 s spacing) ----
  if (now - lastDHTMillis >= dhtInterval)
  {
    lastDHTMillis = now;
    readDHT();
  }

  // ---- LCD page rotation ----
  if (now - lastLCDMillis >= lcdInterval)
  {
    lastLCDMillis = now;
    updateLCD();
    lcdScreen++;
    if (lcdScreen > 4) lcdScreen = 0;   // [MOD] 5 screens: 0-4
  }

  // ---- Power measurement + upload ----
  if (now - lastSensorMillis >= sensorInterval)
  {
    lastSensorMillis = now;

    float newV, newI;
    sampleVI(newV, newI);         // ~100 ms stable RMS window

    // Smooth the displayed reading; snap to 0 instantly when off
    g_voltage = (newV == 0) ? 0
              : (g_voltage <= 0 ? newV
                                : DISPLAY_SMOOTH * g_voltage + (1.0f - DISPLAY_SMOOTH) * newV);

    g_current = (newI == 0) ? 0
              : (g_current <= 0 ? newI
                                : DISPLAY_SMOOTH * g_current + (1.0f - DISPLAY_SMOOTH) * newI);

    if (g_voltage == 0) g_current = 0;   // no mains -> no current

    // ---- Power (apparent: Vrms * Irms) ----
    g_power = g_voltage * g_current;
    if (g_power < 1.0f) g_power = 0;

    // ---- Energy using REAL elapsed time ----
    unsigned long nowE = millis();
    float dtSec = (nowE - lastEnergyMillis) / 1000.0f;
    lastEnergyMillis = nowE;
    if (dtSec > 0 && dtSec < 5.0f)        // ignore abnormal gaps
      energy_kWh += (g_power * dtSec) / 3600000.0f;

    // ---- [NEW] Monthly billing accumulation ----
    updateBilling(g_power, dtSec);

    // ---- Serial debug ----
    Serial.println("========== ENERGY METER ==========");
    Serial.print("Voltage      : "); Serial.print(g_voltage, 2);        Serial.println(" V");
    Serial.print("Current      : "); Serial.print(g_current, 3);        Serial.println(" A");
    Serial.print("Power        : "); Serial.print(g_power, 2);          Serial.println(" W");
    Serial.print("Energy       : "); Serial.print(energy_kWh, 5);       Serial.println(" kWh");
    Serial.print("Monthly kWh  : "); Serial.print(monthly_kWh, 4);      Serial.println(" kWh");
    Serial.print("Est. Bill    : "); Serial.print(monthly_bill_lkr, 2); Serial.println(" LKR");
    Serial.print("Temp         : "); Serial.print(g_fault.temperature, 1); Serial.println(" C");
    Serial.print("Humidity     : "); Serial.print(g_fault.humidity, 1);    Serial.println(" %");
    Serial.print("Flame        : "); Serial.println(g_fault.flameDetected ? "DETECTED" : "None");

    // ---- Upload ----
    sendToServer();
  }
}
