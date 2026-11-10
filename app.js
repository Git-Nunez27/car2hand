document.addEventListener("DOMContentLoaded", () => {
    fetchCars();
});

// ฟังก์ชันดึงข้อมูลจาก Node.js API
async function fetchCars() {
    try {
        // เรียก API ที่รันอยู่บน Localhost
        const response = await fetch('http://localhost:3000/api/cars');
        const cars = await response.json();
        renderCars(cars);
    } catch (error) {
        console.error("Error fetching cars:", error);
    }
}

// ฟังก์ชันสร้าง UI แบบ Bento Grid
function renderCars(cars) {
    const carsListContainer = document.getElementById('cars-list');
    carsListContainer.innerHTML = '';

    cars.forEach(car => {
        // จัด Format ตัวเลขราคาและเลขไมล์ (เช่น 500,000)
        const formattedPrice = Number(car.price).toLocaleString('th-TH');
        const formattedMileage = Number(car.mileage).toLocaleString('th-TH');

        // สร้าง HTML สำหรับรถ 1 คัน
        const carHTML = `
            <div class="car-bento-container">
                <!-- กล่องรูปภาพ -->
                <div class="bento-box box-image">
                    <!-- สมมติว่ามี API ดึงรูปแรก หรือใช้รูป Default -->
                    <img src="https://via.placeholder.com/600x400?text=${car.brand}+${car.model}" alt="${car.model}">
                </div>

                <!-- กล่องชื่อรุ่นรถ -->
                <div class="bento-box box-title">
                    <h2>${car.brand} ${car.model}</h2>
                    <p>สี: ${car.color} | ทะเบียน: ${car.license_plate}</p>
                </div>

                <!-- กล่องปีที่ผลิต -->
                <div class="bento-box box-specs">
                    <h3>ปีที่ผลิต</h3>
                    <p>${car.manufacture_year}</p>
                </div>

                <!-- กล่องเลขไมล์ -->
                <div class="bento-box box-specs">
                    <h3>เลขไมล์ (กม.)</h3>
                    <p>${formattedMileage}</p>
                </div>

                <!-- กล่องราคาและปุ่มติดต่อ -->
                <div class="bento-box box-action">
                    <div class="price">฿${formattedPrice}</div>
                    <button class="btn-contact" onclick="interestCar(${car.id})">สนใจคันนี้</button>
                </div>
            </div>
        `;
        
        carsListContainer.innerHTML += carHTML;
    });
}

// ฟังก์ชันเมื่อลูกค้ากดปุ่ม "สนใจคันนี้"
function interestCar(carId) {
    alert(`ระบบจะพาไปยังหน้าฟอร์มกรอกข้อมูล หรือเปิด LINE OA สำหรับรถรหัส: ${carId}`);
    // อนาคตสามารถเขียนโค้ดเพื่อเด้ง Popup Form (ยิงไปที่ POST /api/leads) 
    // หรือสร้างลิงก์ LINE Deep Link ส่งข้อความอัตโนมัติได้
}