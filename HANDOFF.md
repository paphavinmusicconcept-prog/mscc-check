# MSCC Work Handoff

เอกสารนี้ไว้เปิดตอนย้ายไปทำงานต่อที่คอมร้าน เพื่อกันหลง repo, token, encoding, ชื่อไฟล์ CSV และสถานะ UI ล่าสุด

## ตอนนี้อะไรคือ Live

- Live app repo: `paphavinmusicconcept-prog/mscc-check`
- Stock data repo: `paphavinmusicconcept-prog/mscc-stock-data`
- Render deploy จาก branch `main` ของ `mscc-check`
- แอปหลักอยู่ที่ `server.js`
- หน้า search template อยู่ที่ `index.html`

อย่าแก้ repo เก่า `MSCC-check-stock` ถ้าไม่ได้ตั้งใจย้ายกลับไปใช้

## Feature ที่มีแล้ว

- `/` หน้า search
- `/search` API สำหรับค้นหา
- `/admin` หน้าอัปโหลด CSV แบบ protected ด้วย ID/password
- Drag and drop CSV 4 ไฟล์
- ตรวจชื่อไฟล์ว่าครบและตรง
- Preview ก่อน commit จริง
- ตรวจ encoding และแปลงเป็น UTF-8 ก่อน commit
- Commit CSV เข้า `mscc-stock-data`
- หน้า search แสดงเวลาอัปเดตล่าสุด
- Cache ข้อมูลเพื่อไม่ให้ยิง GitHub ทุก request

## หน้า Search ล่าสุด

- ใช้โทนสีจาก palette: `#e63946`, `#f1faee`, `#a8dadc`, `#457b9d`, `#1d3557`
- Header ใช้โลโก้ Bigtone จากไฟล์ local `assets/bigtone-logo-transparent.png`
- เวลา `อัปเดต` ควรอิงเวลาที่ commit สำเร็จจาก admin upload
- ถ้าไม่มี metadata จาก admin upload ให้ fallback เป็นเวลา commit ล่าสุดของไฟล์ CSV บน GitHub
- ผลลัพธ์หลายรายการเป็น scroll ยาว ไม่ใช้ปุ่มเลขหน้าแล้ว
- ใช้ lazy load เพิ่มรายการเมื่อเลื่อนถึงปุ่ม/จุดโหลดด้านล่าง
- บนมือถือ summary อยู่ก่อนรายละเอียดคลัง
- Layout summary บนมือถือเป็น 2+1:
  - แถวแรก: `Available Stock` และ `SKU`
  - แถวสอง: `ชื่อสินค้า`

## ชื่อไฟล์ CSV ที่ถูกต้อง

ต้องใช้ 4 ไฟล์นี้เท่านั้น:

```text
stock_mscc.CSV
stock_mscc_warehouse.CSV
stock_beh_hq.CSV
stock_beh_warehouse.CSV
```

ข้อควรจำ:

- ใช้ `warehouse`
- ห้ามใช้ชื่อเก่า `werehouse` สำหรับการอัปโหลดใหม่
- `stock_wt.CSV` ไม่อยู่ใน flow นี้แล้ว

## Flow สำหรับคนอัปเดตสต็อก

1. Export CSV จาก Express
2. Rename ชื่อไฟล์ให้ตรงกับ 4 ชื่อด้านบน
3. ไม่เปิดแล้ว save ใน Excel ถ้าไม่จำเป็น
4. เข้า `/admin`
5. ลากไฟล์ทั้ง 4 ไฟล์เข้าไปพร้อมกัน
6. เช็ค preview:
   - rows
   - SKUs
   - encoding
   - ตัวอย่างสินค้า
7. กดยืนยันอัปเดต
8. กลับไปหน้า search แล้วเช็คเวลาอัปเดตล่าสุด

## Token ที่ต้องใช้

มี token 2 แบบ อย่าสับสน:

### 1. Token สำหรับเว็บอัปเดต stock data

ใช้บน Render เป็น env var:

```text
GITHUB_TOKEN=...
```

ต้องมีสิทธิ์:

```text
Repository: mscc-stock-data
Permission: Contents -> Read and write
```

### 2. Token สำหรับแก้โค้ดเว็บ

ใช้ตอน commit โค้ดเข้า repo `mscc-check`

ต้องมีสิทธิ์:

```text
Repository: mscc-check
Permission: Contents -> Read and write
```

ห้ามใส่ token ลง README, HANDOFF, AGENTS หรือไฟล์ใด ๆ ใน repo

ถ้าต้อง set token ใน PowerShell ชั่วคราว ให้ใช้ quote:

```powershell
$env:GITHUB_TOKEN="paste_token_here"
```

ถ้าใส่แบบไม่มี `$env:` หรือไม่มี quote PowerShell จะคิดว่า token คือคำสั่ง และจะขึ้น error ว่า `not recognized as the name of a cmdlet`

## Validation ก่อนบอกว่าเสร็จ

เช็ค syntax:

```bash
node --check server.js
```

ถ้ารัน local แล้ว fetch GitHub ไม่ได้เพราะ certificate บน Windows:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
node server.js
```

ทดสอบ search ด้วย SKU ที่เคยมีปัญหา:

```text
043-01026-2EB
043-01079-2NA
```

ชื่อสต็อกควรเป็นไทย เช่น:

```text
คลังเบ๊
คลังสำนักงานใหญ่เพชรบุรีตัดใหม่
```

ถ้าเห็นข้อความไทยเป็นตัวเพี้ยน แปลว่ายังมี mojibake อยู่ ต้องกลับไปเช็ค source CSV, encoding decode หรือ fallback label

## จุดที่เคยพลาด

- สะกด `warehouse` ผิดเป็น `werehouse`
- Token มีสิทธิ์คนละ repo ทำให้ GitHub API ตอบ 404 หรือ 401
- PowerShell set token ผิดรูปแบบ
- ข้อความไทยใน `DEFAULT_DISPLAY_LABELS` เคยเป็นภาษาต่างดาว
- เคยเผลอ update `server.js` ด้วย placeholder ผ่าน GitHub connector แล้ว rollback แล้ว
- อย่า commit ไฟล์ screenshot preview เช่น `search-mobile*.png` หรือ `search-desktop*.png`

## Model ที่แนะนำ

- แก้เอกสารอย่างเดียว: GPT-5.5 reasoning low
- แก้ UI หรือ logic ไฟล์เดียว: GPT-5.5 reasoning mid
- แก้ GitHub API, Render, encoding, cache, deploy: GPT-5.5 reasoning high

ถ้าเป็นงานที่แตะ token, upload, encoding หรือ deploy อย่าเดา ให้เช็คจาก error และ remote ก่อนทุกครั้ง
