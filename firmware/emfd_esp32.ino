#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Preferences.h>

// =====================================================================
//  WIFI
// =====================================================================
const char* ssid     = "SKS 2.5";
const char* password = "D4803B5A";

// =====================================================================
//  SERVER
//  Live Vercel deployment → ESP32 POSTs sensor data here every 1 s
// =====================================================================
const char* SERVER_URL = "https://emfd-smart-building.vercel.app/api/sensor-data";
const char* DEVICE_ID  = "building-01";
const char* API_KEY    = "esp32-secret-key-2026";

// =====================================================================
//  PINS
// =====================================================================
#define VOLTAGE_PIN  35
#define CURRENT_PIN  34
#define FLAME_PIN    27
#define DHT_PIN      26
#define BUZZER_PIN   25

// =====================================================================
//  LCD
// =====================================================================
LiquidCrystal_I2C lcd(0x27, 16, 2);

// =====================================================================
//  DHT22
// =====================================================================
#define DHT_TYPE DHT22
DHT dht(DHT_PIN, DHT_TYPE);

// =====================================================================
//  ADC
// =====================================================================
#define ADC_RESOLUTION  4095.0
#define ADC_REF         3.3

// =====================================================================
//  ACS712-30A
// =====================================================================
#define ACS_SENSITIVITY  0.044     // V/A for 30A module

// =====================================================================
//  CALIBRATION
// =====================================================================
#define VOLTAGE_CALIBRATION  492

// =====================================================================
//  FAULT THRESHOLDS
// =====================================================================
#define VOLTAGE_NOISE_THRESHOLD  80.0
#define CURRENT_NOISE_THRESHOLD  0.15
#define TEMP_FAULT_THRESHOLD     55.0

// =====================================================================
//  SAMPLING
// =====================================================================
#define RMS_WINDOW_US   100000UL   // 100 ms = 5 full cycles @50Hz
#define DISPLAY_SMOOTH  0.70f      // EMA smoothing (higher = steadier)
#define OFFSET_ADAPT    0.10f      // DC offset adaptation speed

// =====================================================================
//  DHT22 WARMUP — minimum ms after dht.begin() before first read
// =====================================================================
#define DHT_WARMUP_MS   2500UL

// =====================================================================
//  CEB DOMESTIC (D1) TIERED TARIFF — Sri Lanka
//  Post-March 2023 gazette revision.
//  ⚠ Verify with current CEB schedule before deployment.
// =====================================================================
struct CEB_Block {
    float upTo;
    float ratePerUnit;
    float fixedCharge;
};

static const CEB_Block CEB_TARIFF[] = {
    {  30.0f,  4.00f,  30.00f },
    {  60.0f,  7.85f,  60.00f },
    {  90.0f, 10.00f,  90.00f },
    { 120.0f, 27.75f, 180.00f },
    { 180.0f, 32.00f, 240.00f },
    {  1e9f,  45.00f, 480.00f }
};
static const int CEB_BLOCKS = sizeof(CEB_TARIFF) / sizeof(CEB_TARIFF[0]);

// =====================================================================
//  NVS SAVE INTERVAL — every 5 minutes to protect flash
// =====================================================================
#define NVS_SAVE_INTERVAL_MS  300000UL

// =====================================================================
//  STRUCT
// =====================================================================
struct FaultData {
    bool  flameDetected;
    float temperature;
    float humidity;
    bool  tempFault;
    bool  dhtFailed;
};

// =====================================================================
//  GLOBALS — Sensor readings
// =====================================================================
float energy_kWh = 0.0f;
float g_voltage  = 0.0f;
float g_current  = 0.0f;
float g_power    = 0.0f;

FaultData g_fault = {false, 0, 0, false, true};

// =====================================================================
//  GLOBALS — Billing (NVS-backed)
// =====================================================================
Preferences prefs;
float    monthly_kWh      = 0.0f;
float    monthly_bill_lkr = 0.0f;

// =====================================================================
//  TIMING
// =====================================================================
unsigned long lastSensorMillis = 0;
unsigned long lastLCDMillis    = 0;
unsigned long lastDHTMillis    = 0;
unsigned long lastEnergyMillis = 0;
unsigned long lastWifiTry      = 0;
unsigned long lastNVSSaveMs    = 0;
unsigned long dhtReadyAt       = 0;   // ← NEW: absolute time DHT is ready

const long sensorInterval = 1000;
const long lcdInterval    = 1000;
const long dhtInterval    = 2500;
const long wifiRetryMs    = 5000;

// =====================================================================
//  LCD SCREEN
// =====================================================================
int lcdScreen = 0;

// =====================================================================
//  DC OFFSETS (in ADC counts)
// =====================================================================
float voltageOffset = 0;
float currentOffset = 0;


// =====================================================================
//  BUZZER  (active LOW)
// =====================================================================
void buzzerON()  { digitalWrite(BUZZER_PIN, LOW);  }
void buzzerOFF() { digitalWrite(BUZZER_PIN, HIGH); }


// =====================================================================
//  FAST BUZZER / FLAME UPDATE
// =====================================================================
void updateBuzzer()
{
    bool flameNow = (digitalRead(FLAME_PIN) == LOW);
    g_fault.flameDetected = flameNow;

    if (flameNow || g_fault.tempFault)
        buzzerON();
    else
        buzzerOFF();
}


// =====================================================================
//  CALIBRATION
// =====================================================================
void calibrateSensors()
{
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("Calibrating...");
    lcd.setCursor(0, 1); lcd.print("Turn OFF mains");
    delay(2000);

    double voltageSum = 0;
    double currentSum = 0;
    const int samples = 1000;

    for (int i = 0; i < samples; i++) {
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


// =====================================================================
//  SAMPLE V & I — fixed-time RMS window (100 ms = 5 mains cycles)
// =====================================================================
void sampleVI(float &vrms, float &irms)
{
    double sumSqV = 0.0, sumSqI = 0.0;
    double sumV   = 0.0, sumI   = 0.0;
    unsigned long n = 0;

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

        updateBuzzer();
    }

    if (n == 0) { vrms = 0; irms = 0; return; }

    float meanV = (float)(sumV / (double)n);
    float meanI = (float)(sumI / (double)n);
    voltageOffset += (meanV - voltageOffset) * OFFSET_ADAPT;
    currentOffset += (meanI - currentOffset) * OFFSET_ADAPT;

    float vCounts = sqrt(sumSqV / (double)n);
    float iCounts = sqrt(sumSqI / (double)n);

    vrms = vCounts * (ADC_REF / ADC_RESOLUTION) * VOLTAGE_CALIBRATION;
    irms = (iCounts * (ADC_REF / ADC_RESOLUTION)) / ACS_SENSITIVITY;

    if (vrms < VOLTAGE_NOISE_THRESHOLD) vrms = 0;
    if (irms < CURRENT_NOISE_THRESHOLD) irms = 0;
}


// =====================================================================
//  READ DHT22
//  Guard: skips the read if the sensor hasn't had its warmup time yet.
//  This prevents the -999 on first boot.
// =====================================================================
void readDHT()
{
    // Don't attempt a read until the sensor has warmed up
    if (millis() < dhtReadyAt) {
        Serial.println("[DHT] Warmup — skipping read");
        return;
    }

    float h = dht.readHumidity();
    float t = dht.readTemperature();

    Serial.printf("[DHT] Raw h=%.1f  t=%.1f\n", h, t);   // debug

    if (isnan(h) || isnan(t)) {
        g_fault.dhtFailed   = true;
        g_fault.temperature = -999;
        g_fault.humidity    = -999;
        g_fault.tempFault   = false;
        Serial.println("[DHT] Read FAILED — check wiring & pull-up resistor");
    } else {
        g_fault.dhtFailed   = false;
        g_fault.temperature = t;
        g_fault.humidity    = h;
        g_fault.tempFault   = (t >= TEMP_FAULT_THRESHOLD);
    }
}


// =====================================================================
//  CEB TIERED BILL CALCULATOR
// =====================================================================
float calculateCEBBill(float kWh)
{
    if (kWh <= 0.0f) return 0.0f;

    float bill     = 0.0f;
    float blockMin = 0.0f;
    float fixedCh  = CEB_TARIFF[0].fixedCharge;

    for (int i = 0; i < CEB_BLOCKS; i++)
    {
        float blockMax = CEB_TARIFF[i].upTo;

        if (kWh <= blockMax) {
            bill    += (kWh - blockMin) * CEB_TARIFF[i].ratePerUnit;
            fixedCh  = CEB_TARIFF[i].fixedCharge;
            break;
        }
        bill    += (blockMax - blockMin) * CEB_TARIFF[i].ratePerUnit;
        blockMin = blockMax;
        fixedCh  = CEB_TARIFF[i].fixedCharge;
    }

    return bill + fixedCh;
}


// =====================================================================
//  NVS — LOAD
// =====================================================================
void loadFromNVS()
{
    prefs.begin("billing", false);
    monthly_kWh = prefs.getFloat("m_kwh", 0.0f);
    prefs.end();

    Serial.printf("[NVS] Loaded monthly_kWh = %.5f kWh\n", monthly_kWh);
}


// =====================================================================
//  NVS — SAVE
// =====================================================================
void saveToNVS()
{
    prefs.begin("billing", false);
    prefs.putFloat("m_kwh", monthly_kWh);
    prefs.end();

    Serial.printf("[NVS] Saved  monthly_kWh = %.5f kWh\n", monthly_kWh);
}


// =====================================================================
//  BILLING INIT
// =====================================================================
void initBillingSystem()
{
    loadFromNVS();
    monthly_bill_lkr = calculateCEBBill(monthly_kWh);

    Serial.printf("[Billing] Resumed | %.5f kWh | LKR %.2f\n",
                  monthly_kWh, monthly_bill_lkr);
}


// =====================================================================
//  BILLING TICK
// =====================================================================
void updateBilling(float watt, float dtSec)
{
    if (watt > 0.0f && dtSec > 0.0f && dtSec < 5.0f)
        monthly_kWh += (watt * dtSec) / 3600000.0f;

    monthly_bill_lkr = calculateCEBBill(monthly_kWh);

    unsigned long now = millis();
    if (now - lastNVSSaveMs >= NVS_SAVE_INTERVAL_MS) {
        lastNVSSaveMs = now;
        saveToNVS();
    }
}


// =====================================================================
//  BILLING RESET
// =====================================================================
void performBillingReset()
{
    monthly_kWh      = 0.0f;
    monthly_bill_lkr = 0.0f;
    saveToNVS();

    Serial.println("[Billing] *** Monthly reset performed ***");

    for (int i = 0; i < 3; i++) {
        buzzerON();  delay(80);
        buzzerOFF(); delay(80);
    }
}


// =====================================================================
//  LCD UPDATE  (5 screens)
// =====================================================================
void updateLCD()
{
    lcd.clear();

    if (g_fault.flameDetected) {
        lcd.setCursor(0, 0); lcd.print("!! FLAME !!");
        lcd.setCursor(0, 1); lcd.print("CHECK SYSTEM");
        return;
    }

    if (g_fault.tempFault) {
        lcd.setCursor(0, 0); lcd.print("HIGH TEMP!");
        lcd.setCursor(0, 1);
        lcd.print(g_fault.temperature, 1);
        lcd.print((char)223); lcd.print("C");
        return;
    }

    if (lcdScreen == 0) {
        lcd.setCursor(0, 0);
        lcd.print("V: "); lcd.print(g_voltage, 1); lcd.print(" V");
        lcd.setCursor(0, 1);
        lcd.print("I: "); lcd.print(g_current, 2); lcd.print(" A");
    }
    else if (lcdScreen == 1) {
        lcd.setCursor(0, 0);
        lcd.print("P: "); lcd.print(g_power, 1); lcd.print(" W");
        lcd.setCursor(0, 1);
        lcd.print("E: "); lcd.print(energy_kWh, 4); lcd.print(" kWh");
    }
    else if (lcdScreen == 2) {
        if (g_fault.dhtFailed) {
            lcd.setCursor(0, 0); lcd.print("DHT Warming Up");
            lcd.setCursor(0, 1); lcd.print("Please wait...");
        } else {
            lcd.setCursor(0, 0);
            lcd.print("T: "); lcd.print(g_fault.temperature, 1);
            lcd.print((char)223); lcd.print("C");
            lcd.setCursor(0, 1);
            lcd.print("H: "); lcd.print(g_fault.humidity, 1); lcd.print(" %");
        }
    }
    else if (lcdScreen == 3) {
        lcd.setCursor(0, 0);
        if (WiFi.status() == WL_CONNECTED) {
            lcd.print("WiFi Connected");
            lcd.setCursor(0, 1);
            lcd.print(WiFi.localIP().toString());
        } else {
            lcd.print("WiFi Lost");
            lcd.setCursor(0, 1);
            lcd.print("Reconnecting...");
        }
    }
    else if (lcdScreen == 4) {
        lcd.setCursor(0, 0);
        lcd.print("Units:");
        lcd.print(monthly_kWh, 3);
        lcd.setCursor(0, 1);
        lcd.print("Bill:LKR ");
        lcd.print(monthly_bill_lkr, 2);
    }
}


// =====================================================================
//  SEND DATA TO SERVER
// =====================================================================
void sendToServer()
{
    if (WiFi.status() != WL_CONNECTED) return;

    StaticJsonDocument<896> doc;

    doc["device_id"]         = DEVICE_ID;
    doc["voltage"]           = g_voltage;
    doc["current"]           = g_current;
    doc["power"]             = g_power;
    doc["energy_kwh"]        = energy_kWh;
    doc["monthly_kwh"]       = monthly_kWh;
    doc["monthly_bill_lkr"]  = monthly_bill_lkr;
    doc["temperature"]       = g_fault.temperature;
    doc["humidity"]          = g_fault.humidity;
    doc["flame_detected"]    = g_fault.flameDetected;
    doc["temp_fault"]        = g_fault.tempFault;
    doc["dht_error"]         = g_fault.dhtFailed;

    JsonObject units = doc.createNestedObject("units");
    units["voltage"]          = "V";
    units["current"]          = "A";
    units["power"]            = "W";
    units["energy_kwh"]       = "kWh";
    units["monthly_kwh"]      = "kWh";
    units["monthly_bill_lkr"] = "LKR";
    units["temperature"]      = "\u00B0C";
    units["humidity"]         = "%";

    String json;
    serializeJson(doc, json);

    WiFiClientSecure client;
    client.setInsecure();   // Skip SSL cert check — fine for ESP32 → Vercel
    HTTPClient http;

    http.begin(client, SERVER_URL);
    http.setConnectTimeout(5000);
    http.setTimeout(5000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key",   API_KEY);

    int responseCode = http.POST(json);
    Serial.print("HTTP Response: ");
    Serial.println(responseCode);

    // Server returns 201 on success (200 = local dev, 201 = Vercel)
    if (responseCode == 200 || responseCode == 201)
    {
        String responseBody = http.getString();
        Serial.print("[Server] Response: ");
        Serial.println(responseBody);

        StaticJsonDocument<128> respDoc;
        DeserializationError err = deserializeJson(respDoc, responseBody);

        if (!err) {
            bool doReset = respDoc["reset_billing"] | false;
            if (doReset) {
                Serial.println("[Billing] Remote reset command received.");
                performBillingReset();
            }
        } else {
            Serial.print("[JSON] Response parse error: ");
            Serial.println(err.c_str());
        }
    }

    http.end();
}


// =====================================================================
//  SETUP
// =====================================================================
void setup()
{
    Serial.begin(115200);

    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);

    pinMode(FLAME_PIN, INPUT_PULLUP);
    pinMode(BUZZER_PIN, OUTPUT);
    buzzerOFF();

    // ── DHT22 ──────────────────────────────────────────────────────────
    // Begin the sensor, then record the earliest safe read time.
    // The calibration loop + LCD init above already consumes ~2 s,
    // so dhtReadyAt is almost always already past by the time we call
    // readDHT(), but the guard makes it explicit and race-proof.
    dht.begin();
    dhtReadyAt = millis() + DHT_WARMUP_MS;   // ← KEY FIX

    lcd.begin();
    lcd.backlight();
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("EMFD System");
    lcd.setCursor(0, 1); lcd.print("Starting...");
    delay(1000);

    calibrateSensors();   // ~3 s → DHT warmup covered by the time this returns

    initBillingSystem();

    // WiFi
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("Connecting WiFi");

    int wifiTimeout = 0;
    while (WiFi.status() != WL_CONNECTED && wifiTimeout < 20) {
        updateBuzzer();
        delay(250);
        Serial.print(".");
        wifiTimeout++;
    }

    lcd.clear();
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi Connected");
        lcd.setCursor(0, 0); lcd.print("WiFi Connected");
        lcd.setCursor(0, 1); lcd.print(WiFi.localIP().toString());
    } else {
        Serial.println("\nWiFi Failed");
        lcd.setCursor(0, 0); lcd.print("WiFi Failed");
    }
    delay(1000);

    // First DHT read — warmup guard inside readDHT() handles any edge case
    readDHT();
    updateLCD();

    unsigned long t = millis();
    lastLCDMillis    = t;
    lastSensorMillis = t;
    lastDHTMillis    = t;
    lastEnergyMillis = t;
    lastNVSSaveMs    = t;
}


// =====================================================================
//  LOOP
// =====================================================================
void loop()
{
    updateBuzzer();
    unsigned long now = millis();

    // WiFi keep-alive
    if (WiFi.status() != WL_CONNECTED && (now - lastWifiTry >= wifiRetryMs)) {
        lastWifiTry = now;
        WiFi.reconnect();
    }

    // DHT22
    if (now - lastDHTMillis >= dhtInterval) {
        lastDHTMillis = now;
        readDHT();
    }

    // LCD rotation
    if (now - lastLCDMillis >= lcdInterval) {
        lastLCDMillis = now;
        updateLCD();
        lcdScreen++;
        if (lcdScreen > 4) lcdScreen = 0;
    }

    // Power + billing + upload
    if (now - lastSensorMillis >= sensorInterval)
    {
        lastSensorMillis = now;

        float newV, newI;
        sampleVI(newV, newI);

        g_voltage = (newV == 0) ? 0
                  : (g_voltage <= 0 ? newV
                                    : DISPLAY_SMOOTH * g_voltage + (1.0f - DISPLAY_SMOOTH) * newV);

        g_current = (newI == 0) ? 0
                  : (g_current <= 0 ? newI
                                    : DISPLAY_SMOOTH * g_current + (1.0f - DISPLAY_SMOOTH) * newI);

        if (g_voltage == 0) g_current = 0;

        g_power = g_voltage * g_current;
        if (g_power < 1.0f) g_power = 0;

        unsigned long nowE = millis();
        float dtSec = (nowE - lastEnergyMillis) / 1000.0f;
        lastEnergyMillis = nowE;
        if (dtSec > 0 && dtSec < 5.0f)
            energy_kWh += (g_power * dtSec) / 3600000.0f;

        updateBilling(g_power, dtSec);

        Serial.println("========== ENERGY METER ==========");
        Serial.print("Voltage      : "); Serial.print(g_voltage, 2);           Serial.println(" V");
        Serial.print("Current      : "); Serial.print(g_current, 3);           Serial.println(" A");
        Serial.print("Power        : "); Serial.print(g_power, 2);             Serial.println(" W");
        Serial.print("Session kWh  : "); Serial.print(energy_kWh, 5);          Serial.println(" kWh");
        Serial.print("Monthly kWh  : "); Serial.print(monthly_kWh, 5);         Serial.println(" kWh");
        Serial.print("Monthly Bill : LKR "); Serial.println(monthly_bill_lkr, 2);
        Serial.print("Temp         : "); Serial.print(g_fault.temperature, 1); Serial.println(" C");
        Serial.print("Humidity     : "); Serial.print(g_fault.humidity, 1);    Serial.println(" %");
        Serial.print("Flame        : "); Serial.println(g_fault.flameDetected ? "DETECTED" : "None");

        sendToServer();
    }
}
