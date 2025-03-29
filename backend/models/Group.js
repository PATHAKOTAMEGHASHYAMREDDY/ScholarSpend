const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  splits: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      amount: { type: Number, required: true },
    },
  ],
  date: { type: Date, default: Date.now },
});

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  expenses: [expenseSchema],
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Add owner
  isFinalized: { type: Boolean, default: false }, // Add finalized flag
});

module.exports = mongoose.model('Group', groupSchema);