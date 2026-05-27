# MSCC Check

ระบบตรวจสอบสต็อกสำหรับ LINE OA / LIFF

## ภาพรวม

แอปนี้ใช้ค้นหาสต็อกจากไฟล์ CSV และอ่านข้อมูลจาก GitHub raw URL ใน repo `mscc-stock-data`

## ไฟล์ข้อมูล

```text
mscc-stock-data/
  data/
    stock_mscc.CSV
    stock_mscc_warehouse.CSV
    stock_beh_hq.CSV
    stock_beh_warehouse.CSV
```

`stock_wt.CSV` ไม่อยู่ในชุดอัปโหลดของหน้า admin แล้ว

## หน้าอัปโหลด CSV

เปิดหน้า `/admin` แล้วลากไฟล์ CSV ทั้ง 4 ไฟล์มาวางพร้อมกัน ระบบจะตรวจให้ก่อนอัปเดตว่า:

- ชื่อไฟล์ตรงกับรายการที่กำหนด
- มีครบทั้ง 4 ไฟล์
- ไม่มีไฟล์เกินหรือไฟล์ซ้ำ

เมื่ออัปเดตสำเร็จ ระบบจะ commit ไฟล์ CSV ไปที่ `mscc-stock-data` และเขียนเวลาอัปเดตไว้ที่ `data/stock-upload-meta.json` เพื่อให้หน้า search แสดงเวลาอัปเดตล่าสุด

## Environment Variables

```bash
ADMIN_ID=mscc-acc
ADMIN_PASSWORD=
GITHUB_TOKEN=
DATA_REPO=paphavinmusicconcept-prog/mscc-stock-data
DATA_BRANCH=main
CSV_SOURCE=github
GITHUB_RAW_URLS=https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_mscc.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_mscc_warehouse.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_beh_hq.CSV,https://raw.githubusercontent.com/paphavinmusicconcept-prog/mscc-stock-data/main/data/stock_beh_warehouse.CSV
GITHUB_DATA_PATHS=data/stock_mscc.CSV,data/stock_mscc_warehouse.CSV,data/stock_beh_hq.CSV,data/stock_beh_warehouse.CSV
```

`GITHUB_TOKEN` ต้องเป็น GitHub fine-grained personal access token ที่มีสิทธิ์ `Contents: Read and write` เฉพาะ repo `mscc-stock-data`

ฝั่งอ่านข้อมูลจะดึง CSV ล่าสุดผ่าน GitHub Contents API และใช้ commit ล่าสุดของไฟล์ CSV เพื่อแสดงเวลาอัปเดต ดังนั้นถ้าอัปโหลดผ่าน GitHub web โดยตรง หน้า search ก็จะตามเวลาอัปเดตล่าสุดได้เช่นกัน

## วิธีรัน

```bash
npm start
```
