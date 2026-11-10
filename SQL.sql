CREATE DATABASE IF NOT EXISTS car_sales_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
USE car_sales_db;

-- สร้างตารางเก็บข้อมูลรถยนต์ (Cars)
CREATE TABLE IF NOT EXISTS cars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    brand VARCHAR(50) NOT NULL,          -- ยี่ห้อรถ เช่น Toyota, Honda
    model VARCHAR(100) NOT NULL,         -- รุ่นรถ เช่น Camry, Civic
    trim VARCHAR(100) NOT NULL DEFAULT '',
    manufacture_year INT NOT NULL,       -- ปีที่ผลิต
    mileage INT NOT NULL,                -- เลขไมล์
    price DECIMAL(10, 2) NOT NULL,       -- ราคาขาย
    was_price DECIMAL(10, 2) NULL,
    body_type VARCHAR(40) NOT NULL DEFAULT 'Sedan',
    transmission VARCHAR(40) NOT NULL DEFAULT 'ไม่ระบุ',
    fuel VARCHAR(40) NOT NULL DEFAULT 'ไม่ระบุ',
    engine VARCHAR(50) NOT NULL DEFAULT '',
    color VARCHAR(30),                   -- สีรถ
    license_plate VARCHAR(20),           -- ทะเบียนรถ
    image_url VARCHAR(500) NULL,
    video_url VARCHAR(500) NULL,
    is_featured BOOLEAN NOT NULL DEFAULT TRUE,
    is_hot_deal BOOLEAN NOT NULL DEFAULT FALSE,
    warranty_years INT NOT NULL DEFAULT 5,
    status ENUM('available', 'reserved', 'sold') DEFAULT 'available', -- สถานะรถ
    description TEXT,                    -- รายละเอียดเพิ่มเติม
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- For an existing cars table, run this migration once before starting the updated API:
-- ALTER TABLE cars
--     ADD COLUMN trim VARCHAR(100) NOT NULL DEFAULT '',
--     ADD COLUMN was_price DECIMAL(10, 2) NULL,
--     ADD COLUMN body_type VARCHAR(40) NOT NULL DEFAULT 'Sedan',
--     ADD COLUMN transmission VARCHAR(40) NOT NULL DEFAULT 'ไม่ระบุ',
--     ADD COLUMN fuel VARCHAR(40) NOT NULL DEFAULT 'ไม่ระบุ',
--     ADD COLUMN engine VARCHAR(50) NOT NULL DEFAULT '',
--     ADD COLUMN image_url VARCHAR(500) NULL,
--     ADD COLUMN video_url VARCHAR(500) NULL,
--     ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT TRUE,
--     ADD COLUMN is_hot_deal BOOLEAN NOT NULL DEFAULT FALSE,
--     ADD COLUMN warranty_years INT NOT NULL DEFAULT 5;

-- For existing databases that already have the other car columns, run once:
-- ALTER TABLE cars ADD COLUMN video_url VARCHAR(500) NULL;

-- สร้างตารางเก็บข้อมูลลูกค้าที่ติดต่อ/สนใจรถ (Leads)
CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL, -- ชื่อลูกค้า
    phone_number VARCHAR(20) NOT NULL,   -- เบอร์โทรศัพท์
    line_id VARCHAR(50),                 -- LINE ID (เผื่อดึงข้อมูลจากบอท)
    car_id INT,                          -- รหัสรถที่ลูกค้าสนใจ
    inquiry_message TEXT,                -- ข้อความที่ลูกค้าสอบถาม
    lead_status ENUM('new', 'contacted', 'closed') DEFAULT 'new', -- สถานะการติดตามลูกค้า
    contacted_at TIMESTAMP NULL,         -- วันที่เซลส์ติดต่อกลับ
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS car_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    car_id INT NOT NULL,                 -- อ้างอิงรหัสรถจากตาราง cars
    image_url VARCHAR(500) NOT NULL,     -- ที่อยู่ไฟล์รูปภาพ เช่น /uploads/car-123.jpg
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
);

-- For an existing car_images table, run this once:
-- ALTER TABLE car_images ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
-- UPDATE car_images AS image
-- JOIN (
--     SELECT id, ROW_NUMBER() OVER (PARTITION BY car_id ORDER BY id) - 1 AS position
--     FROM car_images
-- ) AS ordered_images ON ordered_images.id = image.id
-- SET image.sort_order = ordered_images.position;

-- Grant application permissions after creating car2hand_app:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON car_sales_db.cars TO 'car2hand_app'@'127.0.0.1';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON car_sales_db.car_images TO 'car2hand_app'@'127.0.0.1';
-- GRANT INSERT ON car_sales_db.leads TO 'car2hand_app'@'127.0.0.1';