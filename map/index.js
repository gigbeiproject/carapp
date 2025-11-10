require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');

const authRoutes = require('../routes/authRoutes');
const carRoutes = require('../routes/carRoutes');
const carCategoriesRoutes = require('../routes/carCategoriesRoutes');
const carbooking = require('../routes/createbookingroute');
const wishlistRoutes = require("../routes/wishlistRoutes");
const ratingRoute = require("../routes/ratingRoute");
const searchRoute = require("../routes/searchRoute");
const couponRoutes = require("../routes/couponRoutes");
const bankRoutes = require("../routes/bankRoutes");

const transactionRoute = require("../routes/transactionRoute");

const hostBookingStartRoutes = require("../routes/host/hostBookingStartRoutes");


const getHostBookingRoute = require("../routes/host/getHostBookingRoute");


const HostCarRoute = require("../routes/host/HostCarRoute");


// chat api

const ChatRoute = require("../routes/chat/ChatRoute");


// admin

const UserRouteadmin = require("../routes/adminroute/UserRoute");

app.use(cors());
app.use(express.json()); // parses application/json
app.use(express.urlencoded({ extended: true })); // parses form-data

app.get('/', (req, res) => {
  res.send('Server is working ✅');
});




app.use('/api/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/car', carRoutes);
app.use('/api/Categorie', carCategoriesRoutes);
app.use('/api/booking', carbooking);
app.use("/wishlist", wishlistRoutes);
app.use("/rating", ratingRoute);
app.use("/search", searchRoute);

// Parse JSON request bodies
app.use(express.json());

// If you also need URL-encoded form data
app.use(express.urlencoded({ extended: true }));
app.use("/coupon", couponRoutes);


app.use("/bank", bankRoutes);



// transactionRoute

app.use("/transaction", transactionRoute);

// Host    hostBookingStartRoutes

app.use("/hostBookingStartRoutes", hostBookingStartRoutes);

// getHostBookingRoute

app.use("/host", getHostBookingRoute);

// HostCarRoute

app.use("/host/car", HostCarRoute);


// ChatRoute


app.use("/chat", ChatRoute);


  

// admin  UserRouteadmin


app.use("/admin", UserRouteadmin);

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "Backend API is responding!" });
});









const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
