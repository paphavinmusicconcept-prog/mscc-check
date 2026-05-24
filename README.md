# MSCC Check

ระบบตรวจสอบสต็อกสำหรับ LINE OA / LIFF

## ภาพรวม

โปรเจกต์นี้เป็นแอป local สำหรับค้นหาสต็อกสินค้า และอ่านข้อมูลจากไฟล์ CSV ทั้งในเครื่องและจาก GitHub raw URL

## โครงสร้างข้อมูล

แนะนำให้แยก repository สำหรับไฟล์ CSV ออกต่างหาก เช่น

```text
mscc-stock-data/
  data/
    stock_mscc.CSV
    stock_mscc_werehouse.CSV
    stock_beh_hq.CSV
    stock_beh_werehouse.CSV
```

## การอัปเดตข้อมูล

1. เปิดไฟล์ CSV ใน GitHub web
2. แก้ไขหรือแทนที่ไฟล์ CSV ตามต้องการ
3. Commit การเปลี่ยนแปลง
4. แอปนี้จะอ่าน raw CSV URL และอัปเดตตามรอบ cache ถัดไป

## การตั้งค่า

สร้างไฟล์ `.env` จาก `.env.example` แล้วกำหนดค่าให้ตรงกับสภาพแวดล้อมจริง

```bash
LIFF_ID=
CSV_SOURCE=github
GITHUB_RAW_URLS=https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_mscc.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_mscc_werehouse.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_beh_hq.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_beh_werehouse.CSV
CACHE_TTL_MS=60000
```

## LIFF

ให้นำแอปขึ้นใช้งานผ่าน HTTPS ก่อน แล้วสร้าง LIFF app ใน LINE Developers Console จากนั้นกำหนด Endpoint URL ให้ชี้มายังแอปที่ deploy แล้ว

เปิดใช้งานผ่าน URL รูปแบบนี้

```text
https://liff.line.me/{liffId}
```

## ข้อมูลสำรองในเครื่อง

หากไม่ได้กำหนด `CSV_SOURCE` แอปจะอ่านไฟล์ใน `data/` ตามรายการนี้

```text
data/stock_mscc.CSV
data/stock_mscc_werehouse.CSV
data/stock_beh_hq.CSV
data/stock_beh_werehouse.CSV
```

## วิธีรัน

```bash
npm start
```
