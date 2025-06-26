const mongoose = require('mongoose');
const { Schema } = mongoose;

const invSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },     // USD
  daily: { type: Number, required: true },
  total: { type: Number, required: true },
  status: { type: String, enum: ['pending','active','completed'], default: 'pending' },
  nowPaymentInvoiceId: String,
  expiresAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Investment', invSchema);
r', userSchema);
