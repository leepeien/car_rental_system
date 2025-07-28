// ========== [1] DEPENDENCIES & CONFIG ========== //
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ========== [2] MULTER SETUP FOR IMAGE UPLOAD ========== //
const uploadPath = path.join(__dirname, 'public/images');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ========== [3] MYSQL CONNECTION ========== //
const db = mysql.createConnection({
  host: 'c237-all.mysql.database.azure.com',
  user: 'c237admin',
  password: 'c2372025!',
  database: 'c237_022_team105'
});
db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL');
});

// ========== [4] MIDDLEWARE ========== //
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));
app.use(flash());

// ========== [5] AUTH MIDDLEWARE ========== //
const checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Login required');
  res.redirect('/login');
};
const checkAdmin = (req, res, next) => {
  if (req.session.user?.role === 'admin') return next();
  req.flash('error', 'Admins only');
  res.redirect('/');
};

// ========== [ROUTES] ========== //
app.get('/', (req, res) => res.render('home', { user: req.session.user }));

app.get('/register', (req, res) => res.render('register', { message: req.flash('error') }));
app.post('/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (results.length > 0) {
      req.flash('error', 'Email already in use');
      return res.redirect('/register');
    }
    const hashed = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashed, role], err => {
        if (err) throw err;
        res.redirect('/login');
      });
  });
});

app.get('/login', (req, res) => res.render('login', { message: req.flash('error') }));
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (!results.length || !(await bcrypt.compare(password, results[0].password))) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/login');
    }
    req.session.user = results[0];
    res.redirect('/cars');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ========== CAR ROUTES ========== //
app.get('/cars', checkAuthenticated, (req, res) => {
  db.query('SELECT * FROM cars', (err, results) => {
    if (err) throw err;
    res.render('cars', {
      cars: results,
      messages: req.flash('success'),
      errors: req.flash('error'),
      isAdminPage: req.session.user.role === 'admin'
    });
  });
});

app.get('/add-car', checkAuthenticated, checkAdmin, (req, res) => res.render('add-car'));
app.post('/add-car', upload.single('image'), (req, res) => {
  const {
    car_model, car_type, rental_rate, rental_term,
    availability, available_from, available_to, pickup_location
  } = req.body;
  const image = req.file ? req.file.filename : '';
  db.query('INSERT INTO cars (car_model, car_type, rental_rate, rental_term, availability, available_from, available_to, pickup_location, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [car_model, car_type, rental_rate, rental_term, availability, available_from, available_to, pickup_location, image],
    err => {
      if (err) throw err;
      req.flash('success', 'Car added!');
      res.redirect('/cars');
    });
});

app.get('/updateCars/:id', checkAuthenticated, checkAdmin, (req, res) => {
  db.query('SELECT * FROM cars WHERE carId = ?', [req.params.id], (err, results) => {
    if (err) throw err;
    if (results.length === 0) return res.status(404).send('Car not found');
    res.render('updateCars', { cars: results[0] });
  });
});
app.post('/updateCars/:id', upload.single('image'), (req, res) => {
  const { plate, brand, model, status, currentImage } = req.body;
  const image = req.file ? req.file.filename : currentImage;
  db.query('UPDATE cars SET plate = ?, brand = ?, model = ?, status = ?, image = ? WHERE carId = ?',
    [plate, brand, model, status, image, req.params.id],
    err => {
      if (err) throw err;
      req.flash('success', 'Car updated');
      res.redirect('/cars');
    });
});

app.get('/deleteCar/:id', checkAuthenticated, checkAdmin, (req, res) => {
  db.query('DELETE FROM cars WHERE carId = ?', [req.params.id], err => {
    if (err) throw err;
    req.flash('success', 'Car deleted');
    res.redirect('/cars');
  });
});

app.get('/search', checkAuthenticated, (req, res) => {
  const term = req.query.q;
  if (!term) return res.redirect('/cars');
  const value = `%${term.toLowerCase()}%`;
  db.query('SELECT * FROM cars WHERE (LOWER(car_model) LIKE ? OR LOWER(car_type) LIKE ?) AND availability = 1',
    [value, value], (err, results) => {
      if (err) throw err;
      res.render('browseCars', { cars: results, searchTerm: term, user: req.session.user });
    });
});

app.get('/cars/:id', checkAuthenticated, (req, res) => {
  db.query('SELECT * FROM cars WHERE carId = ?', [req.params.id], (err, results) => {
    if (err) throw err;
    if (results.length === 0) return res.status(404).send('Car not found');
    res.render('carDetail', { car: results[0] });
  });
});

// ========== CART, BOOKING, CHECKOUT ========== //
app.get('/cart', checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  res.render('cart', { user: req.session.user, cart });
});
app.post('/add-to-rental/:id', checkAuthenticated, (req, res) => {
  const carId = req.params.id;
  const days = parseInt(req.body.days) || 1;
  db.query('SELECT * FROM cars WHERE carId = ?', [carId], (err, results) => {
    if (err) throw err;
    if (!results.length) {
      req.flash('error', 'Car not found.');
      return res.redirect('/cars');
    }
    const car = results[0];
    if (!req.session.cart) req.session.cart = [];
    req.session.cart.push({
      carId: car.carId,
      brand: car.car_model.split(' ')[0],
      car_model: car.car_model,
      rental_rate: parseFloat(car.rental_rate),
      days: days,
      image: car.image
    });
    req.flash('success', 'Car added to cart.');
    res.redirect('/cart');
  });
});
app.post('/checkout', checkAuthenticated, (req, res) => {
  req.session.cart = [];
  req.flash('success', 'Checkout complete!');
  res.redirect('/cars');
});
app.post('/cart/remove/:index', checkAuthenticated, (req, res) => {
  const index = parseInt(req.params.index);
  if (!isNaN(index) && req.session.cart && index >= 0 && index < req.session.cart.length) {
    req.session.cart.splice(index, 1);
    req.flash('success', 'Item removed.');
  }
  res.redirect('/cart');
});

app.get('/bookCar/:id', checkAuthenticated, (req, res) => {
  db.query('SELECT * FROM cars WHERE carId = ?', [req.params.id], (err, results) => {
    if (err) throw err;
    if (!results.length) {
      req.flash('error', 'Car not found');
      return res.redirect('/cars');
    }
    res.render('bookCar', { car: results[0] });
  });
});

// ========== REVIEWS & ENQUIRY ========== //
app.get('/reviews', checkAuthenticated, (req, res) => {
  db.query('SELECT * FROM reviews ORDER BY created_at DESC', (err, results) => {
    if (err) throw err;
    res.render('reviews', {
      user: req.session.user,
      reviews: results,
      messages: req.flash('success'),
      errors: req.flash('error')
    });
  });
});
app.post('/reviews', checkAuthenticated, (req, res) => {
  const username = req.session.user.username;
  const message = req.body.message;
  if (!message.trim()) {
    req.flash('error', 'Message cannot be empty.');
    return res.redirect('/reviews');
  }
  db.query('INSERT INTO reviews (username, message) VALUES (?, ?)', [username, message], err => {
    if (err) throw err;
    req.flash('success', 'Review submitted!');
    res.redirect('/reviews');
  });
});

//******** TODO: Insert code for dashboard route to render dashboard page for users. ********//
app.get('/dashboard', checkAuthenticated, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

//******** TODO: Insert code for admin route to render dashboard page for admin. ********//
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('admin', { user: req.session.user });
});

// ========== START SERVER ========== //
app.listen(3000, () => console.log('Car Rental app running on http://localhost:3000'));
