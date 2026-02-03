const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  // Identifikasi
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  caseNumber: {
    type: Number,
    required: true,
    unique: true
  },
  
  // Status verifikasi
  status: {
    type: String,
    enum: ['pending', 'investigating', 'verified', 'rejected', 'disputed'],
    default: 'pending'
  },
  
  // Risk scoring (0-100)
  riskScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  // Detail kasus
  projectName: String,
  tokenAddress: String,
  evidence: {
    txHash: String,
    solscanLink: String,
    description: String,
    submittedAt: { type: Date, default: Date.now }
  },
  
  // Verifikasi manual
  verification: {
    verifiedBy: String, // "admin" atau nama Anda
    verifiedAt: Date,
    notes: String,
    solscanChecked: { type: Boolean, default: false },
    liquidityLocked: { type: Boolean, default: false }, // false = not locked = red flag
    liquidityAmount: Number, // dalam USD
    victimsLoss: { type: Number, default: 0 }, // dalam USD
    patternFound: [String] // ["liquidity_removal", "team_dump", "honeypot"]
  },
  
  // Metadata
  firstSeen: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },
  reportCount: { type: Number, default: 1 },
  
  // Untuk frontend
  isActive: { type: Boolean, default: true }
});

// Auto-generate case number
walletSchema.pre('save', async function(next) {
  if (this.isNew && !this.caseNumber) {
    const lastWallet = await this.constructor.findOne().sort({ caseNumber: -1 });
    this.caseNumber = lastWallet ? lastWallet.caseNumber + 1 : 1;
  }
  this.lastUpdated = new Date();
  next();
});

// Method untuk calculate risk score otomatis
walletSchema.methods.calculateRiskScore = function() {
  let score = 0;
  
  // Base score dari status
  if (this.status === 'verified') score += 30;
  
  // Liquidity tidak di-lock = red flag besar
  if (this.verification.liquidityLocked === false) score += 40;
  
  // Victim loss
  if (this.verification.victimsLoss > 100000) score += 20;
  else if (this.verification.victimsLoss > 50000) score += 15;
  else if (this.verification.victimsLoss > 10000) score += 10;
  
  // Pattern
  const patterns = this.verification.patternFound || [];
  if (patterns.includes('liquidity_removal')) score += 10;
  if (patterns.includes('team_dump')) score += 10;
  
  this.riskScore = Math.min(score, 100);
  return this.riskScore;
};

module.exports = mongoose.model('Wallet', walletSchema);
