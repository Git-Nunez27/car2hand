const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
}

const app = express();
const uploadDirectory = path.join(__dirname, 'uploads');
const unlinkFile = promisify(fs.unlink);
const maxCarImages = 20;
const port = Number(process.env.PORT || 3000);
const database = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'car2hand_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'car_sales_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
}).promise();

fs.mkdirSync(uploadDirectory, { recursive: true });
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDirectory));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

function requireCarAdmin(req, res, next) {
    const adminKey = process.env.CAR_ADMIN_API_KEY;
    if (!adminKey) {
        return res.status(503).json({ error: 'Car creation is unavailable until CAR_ADMIN_API_KEY is configured.' });
    }

    const suppliedKey = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!suppliedKey) {
        return res.status(401).json({ error: 'A valid admin bearer token is required.' });
    }

    const expected = Buffer.from(adminKey);
    const supplied = Buffer.from(suppliedKey);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
        return res.status(401).json({ error: 'A valid admin bearer token is required.' });
    }

    next();
}

const imageExtensions = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp']
]);
const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDirectory,
        filename: (req, file, callback) => {
            callback(null, `${crypto.randomUUID()}${imageExtensions.get(file.mimetype)}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: maxCarImages },
    fileFilter: (req, file, callback) => {
        if (!imageExtensions.has(file.mimetype)) {
            return callback(new Error('รองรับเฉพาะไฟล์ JPG, PNG และ WebP'));
        }
        callback(null, true);
    }
});

app.get('/api/health', async (req, res) => {
    await database.query('SELECT 1');
    res.json({ status: 'ok' });
});

app.get('/api/admin/session', requireCarAdmin, (req, res) => {
    res.json({ authenticated: true });
});

async function getCars(includeAll = false) {
    const [cars] = await database.query(`SELECT
        id,
        brand AS make,
        model,
        trim,
        manufacture_year AS year,
        price,
        was_price AS wasPrice,
        mileage,
        body_type AS bodyType,
        transmission,
        fuel,
        engine,
        color,
        is_featured AS isFeatured,
        is_hot_deal AS isHotDeal,
        warranty_years AS warrantyYears,
        image_url AS image,
        description,
        status
        FROM cars
        ${includeAll ? '' : "WHERE status = 'available'"}
        ORDER BY created_at DESC`);
    if (cars.length) {
        const carIds = cars.map(car => car.id);
        const [images] = await database.query(
            'SELECT id, car_id AS carId, image_url AS image FROM car_images WHERE car_id IN (?) ORDER BY sort_order, id',
            [carIds]
        );
        const imagesByCar = new Map();
        for (const image of images) {
            const carImages = imagesByCar.get(image.carId) || [];
            carImages.push({ id: image.id, url: image.image });
            imagesByCar.set(image.carId, carImages);
        }
        for (const car of cars) {
            const imageRecords = imagesByCar.get(car.id) || [];
            car.images = imageRecords.length
                ? imageRecords.map(image => image.url)
                : [...new Set([car.image].filter(Boolean))];
            if (includeAll) car.imageRecords = imageRecords;
        }
    }
    return cars;
}

app.get('/api/cars', async (req, res) => {
    res.json(await getCars());
});

app.get('/api/admin/cars', requireCarAdmin, async (req, res) => {
    res.json(await getCars(true));
});

function validateCarPayload(body, uploadedFiles, allowImageUrl) {
    const {
        brand, model, trim = '', manufacture_year, mileage, price,
        was_price = null, body_type = 'Sedan', transmission = 'ไม่ระบุ',
        fuel = 'ไม่ระบุ', engine = '', color = null, license_plate = null,
        image_url: providedImageUrl = null,
        warranty_years = 5, description = null
    } = body;
    const rawFeatured = body.is_featured;
    const rawHotDeal = body.is_hot_deal;
    const normalizedWasPrice = was_price === '' ? null : was_price;
    const isFeatured = rawFeatured === undefined ? true : [true, 1, '1'].includes(rawFeatured);
    const isHotDeal = rawHotDeal === undefined ? false : [true, 1, '1'].includes(rawHotDeal);
    const imageUrl = uploadedFiles.length
        ? `/uploads/${uploadedFiles[0].filename}`
        : providedImageUrl;
    const currentYear = new Date().getFullYear();
    const isText = (value, maxLength, allowEmpty = false) =>
        typeof value === 'string' && value.length <= maxLength &&
        (allowEmpty || value.trim().length > 0);
    const isOptionalText = (value, maxLength) =>
        value === null || value === undefined || isText(value, maxLength, true);
    const isNonNegativeInteger = value =>
        value !== '' && value !== null && value !== undefined &&
        Number.isInteger(Number(value)) && Number(value) >= 0;
    const isPositivePrice = value =>
        value !== '' && value !== null && value !== undefined &&
        Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 99999999.99;
    const validImageUrl = value =>
        value === null || value === undefined || (
            isText(value, 500, true) &&
            (value === '' || value.startsWith('/uploads/') || /^https?:\/\/\S+$/i.test(value))
        );

    if (
        !isText(brand, 50) ||
        !isText(model, 100) ||
        !isText(trim, 100, true) ||
        !Number.isInteger(Number(manufacture_year)) ||
        Number(manufacture_year) < 1886 ||
        Number(manufacture_year) > currentYear + 1 ||
        !isNonNegativeInteger(mileage) ||
        !isPositivePrice(price) ||
        (normalizedWasPrice !== null && normalizedWasPrice !== undefined && !isPositivePrice(normalizedWasPrice)) ||
        !isText(body_type, 40) ||
        !isText(transmission, 40) ||
        !isText(fuel, 40) ||
        !isText(engine, 50, true) ||
        !isOptionalText(color, 30) ||
        !isOptionalText(license_plate, 20) ||
        (allowImageUrl && !validImageUrl(imageUrl)) ||
        ![undefined, true, false, 0, 1, '0', '1'].includes(rawFeatured) ||
        ![undefined, true, false, 0, 1, '0', '1'].includes(rawHotDeal) ||
        !Number.isInteger(Number(warranty_years)) ||
        Number(warranty_years) < 0 ||
        Number(warranty_years) > 20 ||
        !isOptionalText(description, 10000)
    ) {
        return null;
    }

    return {
        brand: brand.trim(),
        model: model.trim(),
        trim: trim.trim(),
        manufactureYear: Number(manufacture_year),
        mileage: Number(mileage),
        price: Number(price),
        wasPrice: normalizedWasPrice === null ? null : Number(normalizedWasPrice),
        bodyType: body_type.trim(),
        transmission: transmission.trim(),
        fuel: fuel.trim(),
        engine: engine.trim(),
        color: color?.trim() || null,
        licensePlate: license_plate?.trim() || null,
        imageUrl: uploadedFiles.length ? imageUrl : allowImageUrl ? imageUrl?.trim() || null : null,
        isFeatured,
        isHotDeal,
        warrantyYears: Number(warranty_years),
        description: description?.trim() || null
    };
}

function carValues(car) {
    return [
        car.brand, car.model, car.trim, car.manufactureYear,
        car.mileage, car.price, car.wasPrice, car.bodyType,
        car.transmission, car.fuel, car.engine, car.color,
        car.licensePlate, car.imageUrl, car.isFeatured, car.isHotDeal,
        car.warrantyYears, car.description
    ];
}

app.post('/api/cars', requireCarAdmin, upload.array('images', maxCarImages), async (req, res) => {
    const uploadedFiles = req.files || [];
    const car = validateCarPayload(req.body || {}, uploadedFiles, true);
    if (!car) {
        await Promise.all(uploadedFiles.map(file => unlinkFile(file.path).catch(error => {
            console.error('Unable to remove invalid uploaded car image:', error);
        })));
        return res.status(400).json({ error: 'ข้อมูลรถไม่ถูกต้อง กรุณาตรวจสอบช่องที่จำเป็นและรูปแบบข้อมูล' });
    }

    const connection = await database.getConnection();
    let carId;
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(`INSERT INTO cars (
            brand, model, trim, manufacture_year, mileage, price, was_price,
            body_type, transmission, fuel, engine, color, license_plate,
            image_url, is_featured, is_hot_deal, warranty_years, description, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`, [
            ...carValues(car)
        ]);
        carId = result.insertId;

        if (uploadedFiles.length) {
            const imageRecords = uploadedFiles.map((file, sortOrder) => [
                carId, `/uploads/${file.filename}`, sortOrder
            ]);
            await connection.query(
                'INSERT INTO car_images (car_id, image_url, sort_order) VALUES ?',
                [imageRecords]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        await Promise.all(uploadedFiles.map(file => unlinkFile(file.path).catch(unlinkError => {
            console.error('Unable to remove uploaded image after failed car creation:', unlinkError);
        })));
        throw error;
    } finally {
        connection.release();
    }

    res.status(201).json({
        message: 'บันทึกข้อมูลรถเรียบร้อยแล้ว',
        id: carId,
        uploadedFiles: uploadedFiles.length
    });
});

app.put('/api/cars/:id', requireCarAdmin, upload.array('images', maxCarImages), async (req, res) => {
    const carId = Number(req.params.id);
    if (!Number.isInteger(carId) || carId <= 0) {
        return res.status(400).json({ error: 'รหัสรถไม่ถูกต้อง' });
    }

    const uploadedFiles = req.files || [];
    const car = validateCarPayload(req.body || {}, uploadedFiles, false);
    if (!car) {
        await Promise.all(uploadedFiles.map(file => unlinkFile(file.path).catch(error => {
            console.error('Unable to remove invalid uploaded car image:', error);
        })));
        return res.status(400).json({ error: 'ข้อมูลรถไม่ถูกต้อง กรุณาตรวจสอบช่องที่จำเป็นและรูปแบบข้อมูล' });
    }

    const connection = await database.getConnection();
    try {
        await connection.beginTransaction();
        const [existingCars] = await connection.execute(
            'SELECT id, image_url AS image FROM cars WHERE id = ? FOR UPDATE',
            [carId]
        );
        if (!existingCars.length) {
            await connection.rollback();
            await Promise.all(uploadedFiles.map(file => unlinkFile(file.path)));
            return res.status(404).json({ error: 'ไม่พบรถที่ต้องการแก้ไข' });
        }

        if (uploadedFiles.length) {
            const [imageCounts] = await connection.execute(
                'SELECT COUNT(*) AS imageCount, COALESCE(MAX(sort_order), -1) AS lastOrder FROM car_images WHERE car_id = ?',
                [carId]
            );
            const existingImageCount = Number(imageCounts[0].imageCount) ||
                (existingCars[0].image ? 1 : 0);
            if (existingImageCount + uploadedFiles.length > maxCarImages) {
                await connection.rollback();
                await Promise.all(uploadedFiles.map(file => unlinkFile(file.path).catch(error => {
                    console.error('Unable to remove excess uploaded car image:', error);
                })));
                return res.status(400).json({
                    error: `รถหนึ่งคันเพิ่มรูปได้ไม่เกิน ${maxCarImages} รูป`
                });
            }
        }

        const updates = carValues(car);
        const setImage = uploadedFiles.length > 0;
        const [result] = await connection.execute(`UPDATE cars SET
            brand = ?, model = ?, trim = ?, manufacture_year = ?, mileage = ?, price = ?,
            was_price = ?, body_type = ?, transmission = ?, fuel = ?, engine = ?, color = ?,
            license_plate = ?, ${setImage ? 'image_url = ?,' : ''} is_featured = ?, is_hot_deal = ?,
            warranty_years = ?, description = ?
            WHERE id = ?`, [
            ...updates.slice(0, 13),
            ...(setImage ? [car.imageUrl] : []),
            ...updates.slice(14),
            carId
        ]);

        if (uploadedFiles.length) {
            const [existingImages] = await connection.execute(
                'SELECT COALESCE(MAX(sort_order), -1) AS lastOrder FROM car_images WHERE car_id = ?',
                [carId]
            );
            const firstOrder = Number(existingImages[0].lastOrder) + 1;
            const imageRecords = uploadedFiles.map((file, index) => [
                carId, `/uploads/${file.filename}`, firstOrder + index
            ]);
            await connection.query(
                'INSERT INTO car_images (car_id, image_url, sort_order) VALUES ?',
                [imageRecords]
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        await Promise.all(uploadedFiles.map(file => unlinkFile(file.path).catch(unlinkError => {
            console.error('Unable to remove uploaded image after failed car update:', unlinkError);
        })));
        throw error;
    } finally {
        connection.release();
    }

    res.json({ message: 'แก้ไขข้อมูลรถเรียบร้อยแล้ว', id: carId, uploadedFiles: uploadedFiles.length });
});

app.put('/api/cars/:id/images/order', requireCarAdmin, async (req, res) => {
    const carId = Number(req.params.id);
    const imageIds = req.body?.imageIds;
    if (!Number.isInteger(carId) || carId <= 0 ||
        !Array.isArray(imageIds) ||
        imageIds.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0) ||
        new Set(imageIds.map(Number)).size !== imageIds.length) {
        return res.status(400).json({ error: 'ลำดับรูปภาพไม่ถูกต้อง' });
    }

    const connection = await database.getConnection();
    try {
        await connection.beginTransaction();
        const [cars] = await connection.execute(
            'SELECT id FROM cars WHERE id = ? FOR UPDATE',
            [carId]
        );
        if (!cars.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'ไม่พบรถที่ต้องการจัดเรียงรูปภาพ' });
        }
        const [images] = await connection.execute(
            'SELECT id FROM car_images WHERE car_id = ? ORDER BY sort_order, id FOR UPDATE',
            [carId]
        );
        const requestedIds = imageIds.map(Number);
        if (images.length !== requestedIds.length ||
            images.some(image => !requestedIds.includes(Number(image.id)))) {
            await connection.rollback();
            return res.status(400).json({ error: 'รายการรูปภาพมีการเปลี่ยนแปลง กรุณาโหลดรายการใหม่' });
        }

        for (const [sortOrder, imageId] of requestedIds.entries()) {
            await connection.execute(
                'UPDATE car_images SET sort_order = ? WHERE id = ? AND car_id = ?',
                [sortOrder, imageId, carId]
            );
        }
        if (requestedIds.length) {
            await connection.execute(
                'UPDATE cars SET image_url = (SELECT image_url FROM car_images WHERE id = ?) WHERE id = ?',
                [requestedIds[0], carId]
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    res.json({ message: 'บันทึกลำดับรูปภาพเรียบร้อยแล้ว' });
});

app.delete('/api/cars/:id', requireCarAdmin, async (req, res) => {
    const carId = Number(req.params.id);
    if (!Number.isInteger(carId) || carId <= 0) {
        return res.status(400).json({ error: 'รหัสรถไม่ถูกต้อง' });
    }

    const connection = await database.getConnection();
    let imageUrls;
    try {
        await connection.beginTransaction();
        const [cars] = await connection.execute(
            'SELECT image_url AS image FROM cars WHERE id = ? FOR UPDATE',
            [carId]
        );
        if (!cars.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'ไม่พบรถที่ต้องการลบ' });
        }
        const [images] = await connection.execute(
            'SELECT image_url AS image FROM car_images WHERE car_id = ?',
            [carId]
        );
        imageUrls = [...new Set([cars[0].image, ...images.map(image => image.image)].filter(Boolean))];
        await connection.execute('DELETE FROM cars WHERE id = ?', [carId]);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    await Promise.all(imageUrls.map(async imageUrl => {
        if (!imageUrl.startsWith('/uploads/')) return;
        const filename = path.basename(imageUrl);
        const imagePath = path.resolve(uploadDirectory, filename);
        if (path.dirname(imagePath) !== path.resolve(uploadDirectory)) return;
        try {
            await unlinkFile(imagePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Unable to remove deleted car image:', error);
            }
        }
    }));

    res.json({ message: 'ลบข้อมูลรถเรียบร้อยแล้ว', id: carId });
});

app.post('/api/leads', async (req, res) => {
    const { customer_name, phone_number, line_id = null, car_id = null, inquiry_message = null } = req.body || {};
    const optionalText = value => value === '' ? null : value;
    const optionalLineId = optionalText(line_id);
    const optionalInquiry = optionalText(inquiry_message);
    const optionalCarId = car_id === '' ? null : car_id;
    const isText = (value, maxLength) =>
        typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;

    if (
        !isText(customer_name, 100) ||
        !isText(phone_number, 20) ||
        (optionalLineId !== null && !isText(optionalLineId, 50)) ||
        (optionalInquiry !== null && (typeof optionalInquiry !== 'string' || optionalInquiry.length > 10000)) ||
        (optionalCarId !== null && (!Number.isInteger(Number(optionalCarId)) || Number(optionalCarId) <= 0))
    ) {
        return res.status(400).json({ error: 'ข้อมูลติดต่อไม่ถูกต้อง' });
    }

    const [result] = await database.execute(
        'INSERT INTO leads (customer_name, phone_number, line_id, car_id, inquiry_message) VALUES (?, ?, ?, ?, ?)',
        [
            customer_name.trim(), phone_number.trim(), optionalLineId?.trim() || null,
            optionalCarId === null ? null : Number(optionalCarId), optionalInquiry?.trim() || null
        ]
    );
    res.status(201).json({ message: 'บันทึกข้อมูลติดต่อเรียบร้อยแล้ว', lead_id: result.insertId });
});

app.post('/api/cars/:car_id/images', requireCarAdmin, upload.array('images', maxCarImages), async (req, res) => {
    const carId = Number(req.params.car_id);
    if (!Number.isInteger(carId) || carId <= 0) {
        return res.status(400).json({ error: 'รหัสรถไม่ถูกต้อง' });
    }
    if (!req.files?.length) {
        return res.status(400).json({ error: 'กรุณาแนบไฟล์รูปภาพ' });
    }

    const connection = await database.getConnection();
    try {
        await connection.beginTransaction();
        const [cars] = await connection.execute(
            'SELECT id, image_url AS image FROM cars WHERE id = ? FOR UPDATE',
            [carId]
        );
        if (!cars.length) {
            await connection.rollback();
            await Promise.all(req.files.map(file => unlinkFile(file.path)));
            return res.status(404).json({ error: 'ไม่พบรถที่ต้องการเพิ่มรูปภาพ' });
        }
        const [existingImages] = await connection.execute(
            'SELECT COUNT(*) AS imageCount, COALESCE(MAX(sort_order), -1) AS lastOrder FROM car_images WHERE car_id = ?',
            [carId]
        );
        const existingImageCount = Number(existingImages[0].imageCount) ||
            (cars[0].image ? 1 : 0);
        if (existingImageCount + req.files.length > maxCarImages) {
            await connection.rollback();
            await Promise.all(req.files.map(file => unlinkFile(file.path).catch(error => {
                console.error('Unable to remove excess uploaded car image:', error);
            })));
            return res.status(400).json({
                error: `รถหนึ่งคันเพิ่มรูปได้ไม่เกิน ${maxCarImages} รูป`
            });
        }

        const firstOrder = Number(existingImages[0].lastOrder) + 1;
        const imageRecords = req.files.map((file, index) => [
            carId, `/uploads/${file.filename}`, firstOrder + index
        ]);
        await connection.query(
            'INSERT INTO car_images (car_id, image_url, sort_order) VALUES ?',
            [imageRecords]
        );
        await connection.execute('UPDATE cars SET image_url = ? WHERE id = ?', [imageRecords[0][1], carId]);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        await Promise.all(req.files.map(file => unlinkFile(file.path).catch(unlinkError => {
            console.error('Unable to remove uploaded car image after failed upload:', unlinkError);
        })));
        throw error;
    } finally {
        connection.release();
    }
    res.status(201).json({ message: 'อัปโหลดรูปภาพสำเร็จ', uploadedFiles: req.files.length });
});

app.use((error, req, res, next) => {
    console.error('Request failed:', error);
    if (res.headersSent) {
        return next(error);
    }
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: 'ไฟล์รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกินกำหนด' });
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'ข้อมูลหรือไฟล์ที่ส่งมามีขนาดใหญ่เกินกำหนด' });
    }
    if (error.message === 'รองรับเฉพาะไฟล์ JPG, PNG และ WebP') {
        return res.status(400).json({ error: error.message });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ error: 'รูปแบบ JSON ไม่ถูกต้อง' });
    }
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง' });
});

async function startServer() {
    try {
        await database.query('SELECT 1');
    } catch (error) {
        console.error('เชื่อมต่อ MySQL ไม่สำเร็จ ตรวจสอบค่าในไฟล์ .env และสถานะ MySQL Server');
        console.error(error.message);
        process.exitCode = 1;
        return;
    }

    app.listen(port, () => {
        console.log(`CARS27 พร้อมใช้งานที่ http://127.0.0.1:${port}`);
        console.log(`เชื่อมต่อฐานข้อมูล ${process.env.DB_NAME || 'car_sales_db'} สำเร็จ`);
    });
}

startServer();
