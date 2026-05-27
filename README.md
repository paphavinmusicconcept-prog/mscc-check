# MSCC Check

ระบบค้นหาและอัปเดตสต็อกสำหรับ MSCC

## ภาพรวม

แอปนี้ใช้ค้นหาสต็อกจากไฟล์ CSV และอ่าน/เขียนข้อมูลผ่าน GitHub

- App repo: `paphavinmusicconcept-prog/mscc-check`
- Data repo: `paphavinmusicconcept-prog/mscc-stock-data`
- Live app deploy จาก `mscc-check/main` ผ่าน Render

ไฟล์หลักของแอป:

```text
server.js
index.html
```

## ไฟล์ CSV ที่ใช้งาน

หน้า `/admin` รับไฟล์ CSV ทั้งหมด 4 ไฟล์เท่านั้น:

```text
stock_mscc.CSV
stock_mscc_warehouse.CSV
stock_beh_hq.CSV
stock_beh_warehouse.CSV
```

`stock_wt.CSV` ไม่อยู่ในชุดอัปโหลดแล้ว

หมายเหตุ: ชื่อ `warehouse` ต้องสะกดแบบนี้ ห้ามใช้ชื่อเก่า `werehouse` สำหรับการอัปโหลดใหม่

## Flow ของคนอัปเดตสต็อก

1. Export CSV จาก Express
2. Rename ชื่อไฟล์ด้วยคลิกขวา Rename หรือ rename จากระบบไฟล์
3. ไม่ต้องเปิดไฟล์ใน Excel
4. เข้า `/admin`
5. ลากไฟล์ CSV ทั้ง 4 ไฟล์เข้าไปพร้อมกัน
6. ตรวจหน้า preview ก่อนยืนยัน
7. กด `ยืนยันและอัปเดตเข้า GitHub`
8. รอระบบ commit เข้า `mscc-stock-data`
9. หน้า search จะโหลดข้อมูลใหม่และแสดงเวลาอัปเดตล่าสุด

## Encoding

ไฟล์ CSV จาก Express อาจเป็น `Windows-874` หรือ `UTF-8`

ระบบจะ:

- อ่านไฟล์เป็น bytes ก่อน
- ตรวจ encoding
- แปลงไฟล์ที่ผ่าน validation เป็น UTF-8
- commit ไฟล์ UTF-8 เข้า GitHub

ถ้าข้อความไทยพังก่อนอัปโหลด ระบบอาจกู้กลับไม่ได้ 100% ดังนั้น flow ที่ปลอดภัยที่สุดคือ export จาก Express แล้ว rename อย่างเดียว

## Environment Variables

ค่าที่ต้องมีบน Render:

```bash
ADMIN_ID=mscc-acc
ADMIN_PASSWORD=
GITHUB_TOKEN=
DATA_REPO=paphavinmusicconcept-prog/mscc-stock-data
DATA_BRANCH=main
CSV_SOURCE=github
GITHUB_DATA_PATHS=data/stock_mscc.CSV,data/stock_mscc_warehouse.CSV,data/stock_beh_hq.CSV,data/stock_beh_warehouse.CSV
GITHUB_REFRESH_TTL_MS=60000
```

`GITHUB_TOKEN` ของเว็บต้องเป็น fine-grained token ที่มีสิทธิ์:

```text
Repository: paphavinmusicconcept-prog/mscc-stock-data
Permissions: Contents -> Read and write
```

ห้าม commit token หรือ password ลงไฟล์ใน repo

## การรัน/ตรวจในเครื่อง

ถ้ามี Node.js:

```bash
node --check server.js
node server.js
```

ค่า default จะรันที่:

```text
http://localhost:3000
```

ถ้าเจอปัญหา certificate ตอน fetch GitHub บน Windows ให้ลอง:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
node server.js
```

## หลังแก้โค้ด

ก่อนบอกว่าเสร็จ ควรเช็คอย่างน้อย:

```bash
node --check server.js
```

แล้วเช็ค:

- ชื่อไฟล์ CSV ยังเป็น 4 ไฟล์ที่ถูกต้อง
- ไม่มี `stock_wt.CSV` กลับมาใน upload flow
- หน้า search ไม่แสดงชื่อสต็อกเป็นภาษาต่างดาว
- `/admin` ยัง preview ก่อน commit ได้
- push ขึ้น `mscc-check/main` แล้ว
- รอ Render deploy ก่อนบอกว่า live fixed
