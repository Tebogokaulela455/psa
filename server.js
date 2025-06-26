require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const User = require('./models/User');
const Investment = require('./models/Investment');

const app = express();
app.use(express.json());
app.use(cors());

// connect DB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=>console.log('MongoDB connected'))
  .catch(console.error);

// auth middleware
const auth = (req,res,next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('No token');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).send('Invalid token');
  }
};

// predefined plans
const plans = {5:0.1,8:0.4,12:0.7,15:0.9,20:1.0,30:1.2,40:1.5};
function getPlanInfo(amount){
  if (!plans[amount]) return null;
  const daily = plans[amount];
  return { amount, daily, total: daily*28 };
}

// — AUTH ROUTES —

app.post('/api/auth/register', async (req,res)=>{
  const { email,password } = req.body;
  try {
    const u = new User({email,password});
    await u.save();
    res.status(201).send('Registered');
  } catch(e){
    res.status(400).send('Email taken');
  }
});

app.post('/api/auth/login', async (req,res)=>{
  const { email,password } = req.body;
  const u = await User.findOne({ email });
  if (!u || !await u.comparePassword(password)) 
    return res.status(401).send('Invalid');
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn:'7d' });
  res.json({ token });
});

// forgot password (stub)
app.post('/api/auth/forgot', (req,res)=>{
  // you would generate a reset token and email it
  res.send('If that email is registered, you will receive reset instructions.');
});

// — INVESTMENT ROUTES —

app.get('/api/invest/plan-info/:amount', (req,res)=>{
  const info = getPlanInfo(Number(req.params.amount));
  if (!info) return res.status(400).send('Invalid plan');
  res.json(info);
});

app.post('/api/invest/confirm', auth, async (req,res)=>{
  const { amount, paymentMethod } = req.body;
  const info = getPlanInfo(amount);
  if (!info) return res.status(400).send('Invalid plan');
  // create NowPayments invoice
  const invoice = await axios.post('https://api.nowpayments.io/v1/invoice', {
    price_amount: amount,
    price_currency: 'usd',
    pay_currency: paymentMethod === 'Crypto' ? 'btc' : 'usd',
    order_id: `inv_${Date.now()}`,
    ipn_callback_url: 'https://your-domain.com/api/invest/ipn',
  }, {
    headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY }
  }).then(r=>r.data);

  // store investment
  const inv = new Investment({
    user: req.user.id,
    amount: info.amount,
    daily: info.daily,
    total: info.total,
    nowPaymentInvoiceId: invoice.id,
    expiresAt: new Date(Date.now() + 28*24*60*60*1000)
  });
  await inv.save();

  res.json({ invoiceUrl: invoice.invoice_url });
});

// IPN handler
app.post('/api/invest/ipn', async (req,res)=>{
  // verify IPN secret, update investment status, credit user wallet
  const { invoice_id, payment_status } = req.body;
  if (req.headers['x-nowpayments-signature'] !== process.env.NOWPAYMENTS_IPN_SECRET)
    return res.status(403).end();
  const inv = await Investment.findOne({ nowPaymentInvoiceId: invoice_id });
  if (!inv) return res.status(404).end();
  if (payment_status === 'finished' && inv.status==='pending'){
    inv.status = 'active';
    await inv.save();
    // credit first day's earnings to user
    const u = await User.findById(inv.user);
    u.balance += inv.daily;
    await u.save();
  }
  res.json({ ok:true });
});

// — WITHDRAWAL ROUTE —

app.post('/api/withdraw', auth, async (req,res)=>{
  const u = await User.findById(req.user.id);
  if (u.balance < 1) return res.status(400).send('Minimum withdrawal is $1');
  // process withdrawal (e.g. send funds to user)...
  u.balance = 0;
  await u.save();
  res.send('Withdrawal successful');
});

// start
app.listen(process.env.PORT||4000, ()=>console.log(`Listening on ${process.env.PORT||4000}`));
