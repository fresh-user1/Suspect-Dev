const express = require('express');
const router = express.Router();
const Wallet = require('../models/Wallet');
const axios = require('axios');

// GET /api/wallets - Ambil semua wallet verified (untuk public frontend)
router.get('/', async (req, res) => {
  try {
    const { status = 'verified', limit = 50, sort = '-riskScore' } = req.query;
    
    const wallets = await Wallet.find({ 
      status, 
      isActive: true 
    })
    .sort(sort)
    .limit(parseInt(limit))
    .select('-__v');
    
    res.json({
      success: true,
      count: wallets.length,
      data: wallets
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/wallets/:address - Cek specific wallet
router.get('/:address', async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ 
      walletAddress: req.params.address 
    });
    
    if (!wallet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Wallet not found in database' 
      });
    }
    
    res.json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/wallets - Submit laporan baru (public)
router.post('/', async (req, res) => {
  try {
    const { walletAddress, evidence, projectName, tokenAddress } = req.body;
    
    // Validasi basic Solana address (Base58, 32-44 chars)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!base58Regex.test(walletAddress)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid Solana wallet address' 
      });
    }
    
    // Cek duplicate
    const existing = await Wallet.findOne({ walletAddress });
    if (existing) {
      existing.reportCount += 1;
      existing.lastUpdated = new Date();
      await existing.save();
      return res.json({ 
        success: true, 
        message: 'Report added to existing case', 
        data: existing 
      });
    }
    
    // Buat wallet baru
    const wallet = new Wallet({
      walletAddress,
      projectName,
      tokenAddress,
      evidence: {
        txHash: evidence?.txHash,
        solscanLink: evidence?.solscanLink,
        description: evidence?.description
      },
      status: 'pending'
    });
    
    await wallet.save();
    
    res.status(201).json({ 
      success: true, 
      message: 'Report submitted for review',
      data: wallet
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/wallets/:id/verify - Verifikasi manual (admin only)
router.patch('/:id/verify', async (req, res) => {
  try {
    const { 
      status, 
      notes, 
      liquidityLocked, 
      liquidityAmount,
      victimsLoss,
      patternFound,
      verifiedBy = 'admin'
    } = req.body;
    
    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    
    // Update verifikasi
    wallet.status = status || wallet.status;
    wallet.verification = {
      ...wallet.verification,
      verifiedBy,
      verifiedAt: new Date(),
      notes,
      solscanChecked: true,
      liquidityLocked: liquidityLocked !== undefined ? liquidityLocked : wallet.verification?.liquidityLocked,
      liquidityAmount: liquidityAmount || wallet.verification?.liquidityAmount,
      victimsLoss: victimsLoss || wallet.verification?.victimsLoss,
      patternFound: patternFound || wallet.verification?.patternFound
    };
    
    // Recalculate risk score
    wallet.calculateRiskScore();
    
    await wallet.save();
    
    res.json({ 
      success: true, 
      message: 'Wallet verified successfully',
      data: wallet
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/wallets/:id - Soft delete (admin)
router.delete('/:id', async (req, res) => {
  try {
    const wallet = await Wallet.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    res.json({ success: true, message: 'Wallet deactivated', data: wallet });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/wallets/stats/summary - Dashboard stats
router.get('/stats/summary', async (req, res) => {
  try {
    const stats = await Wallet.aggregate([
      { $match: { isActive: true } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalVictimsLoss: { $sum: '$verification.victimsLoss' }
      }}
    ]);
    
    const totalVerified = await Wallet.countDocuments({ 
      status: 'verified',
      isActive: true 
    });
    
    const highRisk = await Wallet.countDocuments({
      status: 'verified',
      riskScore: { $gte: 70 },
      isActive: true
    });
    
    res.json({
      success: true,
      data: {
        stats,
        totalVerified,
        highRisk,
        totalVictimsLoss: stats.reduce((sum, s) => sum + (s.totalVictimsLoss || 0), 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
