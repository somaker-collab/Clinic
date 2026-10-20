const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const adminRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'smilecraft-secure-secret-key-2026';

// Middleware to verify admin JWT
const verifyAdmin = (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminId = decoded.adminId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Check if setup is needed
const checkSetup = async (req, res, next) => {
  const count = await req.db.collection('admins').countDocuments();
  if (count === 0 && !req.path.includes('/setup')) {
    return res.redirect('/admin/setup');
  }
  if (count > 0 && req.path === '/setup') {
    return res.redirect('/admin');
  }
  next();
};

adminRouter.use(checkSetup);

// --- ADMIN API ENDPOINTS ---
adminRouter.post('/api/setup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  
  const count = await req.db.collection('admins').countDocuments();
  if (count > 0) return res.status(403).json({ error: 'Already setup' });

  const passwordHash = await bcrypt.hash(password, 10);
  await req.db.collection('admins').insertOne({ username, passwordHash, role: 'superadmin', active: true, createdAt: new Date() });

  // Seed Initial Dummy Data
  const services = [
    { name: 'General Dental Consultation', slug: 'general-consultation', description: 'Comprehensive oral examination.', price: 500, priceLabel: 'NPR 500', durationMinutes: 30, active: true },
    { name: 'Dental Cleaning and Scaling', slug: 'cleaning-scaling', description: 'Professional plaque removal.', price: 1500, priceLabel: 'NPR 1,500', durationMinutes: 45, active: true },
    { name: 'Teeth Whitening', slug: 'teeth-whitening', description: 'Advanced laser whitening.', price: 5000, priceLabel: 'NPR 5,000', durationMinutes: 60, active: true },
    { name: 'Root Canal Treatment', slug: 'root-canal', description: 'Pain-free root canal therapy.', price: 8000, priceLabel: 'NPR 8,000+', durationMinutes: 90, active: true },
    { name: 'Dental Implants', slug: 'dental-implants', description: 'Permanent tooth replacements.', price: 35000, priceLabel: 'NPR 35,000+', durationMinutes: 120, active: true }
  ];
  await req.db.collection('services').insertMany(services.map(s => ({ ...s, createdAt: new Date() })));

  const dentistServices = await req.db.collection('services').find().toArray();
  const serviceIds = dentistServices.map(s => s._id.toString());
  
  const dentists = [
    { name: 'Dr. Aarav Sharma', specialty: 'General Dentistry', bio: 'Expert in preventive treatments.', serviceIds: serviceIds.slice(0,2), active: true },
    { name: 'Dr. Sushma Adhikari', specialty: 'Restorative Dentistry', bio: 'Specialist in root canals and implants.', serviceIds: serviceIds.slice(3,5), active: true },
    { name: 'Dr. Nisha Karki', specialty: 'Orthodontic Consultation', bio: 'Dedicated to advanced teeth alignments.', serviceIds: serviceIds, active: true }
  ];
  await req.db.collection('dentists').insertMany(dentists.map(d => ({ ...d, createdAt: new Date() })));

  res.json({ success: true });
});

adminRouter.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await req.db.collection('admins').findOne({ username, active: true });
  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ adminId: admin._id }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 43200000 });
  res.json({ success: true });
});

adminRouter.post('/api/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

adminRouter.get('/api/stats', verifyAdmin, async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const total = await req.db.collection('appointments').countDocuments();
  const pending = await req.db.collection('appointments').countDocuments({ status: 'Pending' });
  const todays = await req.db.collection('appointments').countDocuments({ startAt: { $gte: today } });
  res.json({ total, pending, todays });
});

adminRouter.get('/api/appointments', verifyAdmin, async (req, res) => {
  const appointments = await req.db.collection('appointments').find().sort({ startAt: -1 }).limit(100).toArray();
  res.json(appointments);
});

adminRouter.put('/api/appointments/:id/status', verifyAdmin, async (req, res) => {
  await req.db.collection('appointments').updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: req.body.status, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

// --- ADMIN UI ---
const adminHTML = (title, content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | SmileCraft Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root { --primary:#27B8A5; --bg:#F5F8FC; --surf:#FFF; --text:#203047; --mut:#718096;
      --sh-out: 8px 8px 16px #d1d9e6, -8px -8px 16px #ffffff;
      --sh-in: inset 6px 6px 12px #d1d9e6, inset -6px -6px 12px #ffffff; }
    * { box-sizing:border-box; margin:0; padding:0; font-family:'Plus Jakarta Sans',sans-serif; }
    body { background:var(--bg); color:var(--text); display:flex; flex-direction:column; min-height:100vh; }
    .clay-card { background:var(--surf); border-radius:20px; box-shadow:var(--sh-out); padding:24px; }
    .clay-btn { background:var(--primary); color:#fff; border:none; padding:12px 24px; border-radius:30px; box-shadow:var(--sh-out); cursor:pointer; font-weight:600; width:100%; margin-top:10px; }
    .clay-btn:active { box-shadow:var(--sh-in); transform:scale(0.98); }
    .clay-input { width:100%; padding:14px; border:none; border-radius:15px; background:var(--bg); box-shadow:var(--sh-in); margin-bottom:15px; outline:none; }
    .auth-box { max-width:400px; margin:100px auto; text-align:center; }
    .dash { display:flex; height:100vh; }
    .sidebar { width:250px; padding:30px 20px; display:flex; flex-direction:column; gap:15px; }
    .nav-item { padding:15px; border-radius:15px; cursor:pointer; display:flex; align-items:center; gap:10px; font-weight:600; color:var(--mut); }
    .nav-item.active { background:var(--surf); box-shadow:var(--sh-out); color:var(--primary); }
    .main { flex:1; padding:40px; overflow-y:auto; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:24px; margin-bottom:40px; }
    table { width:100%; border-collapse:collapse; margin-top:20px; }
    th,td { padding:15px; text-align:left; border-bottom:2px solid var(--bg); }
    .badge { padding:6px 12px; border-radius:20px; font-size:0.8rem; font-weight:700; }
  </style>
</head>
<body>${content}<script>lucide.createIcons();</script></body>
</html>`;

adminRouter.get('/setup', (req, res) => res.send(adminHTML('Setup', `
  <div class="clay-card auth-box"><h2>System Setup</h2><p style="margin-bottom:20px;">Initialize admin</p>
  <input type="text" id="u" class="clay-input" placeholder="Username" /><input type="password" id="p" class="clay-input" placeholder="Password" />
  <button class="clay-btn" onclick="fetch('/admin/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})}).then(()=>location.href='/admin')">Initialize</button></div>`)));

adminRouter.get('/login', (req, res) => res.send(adminHTML('Login', `
  <div class="clay-card auth-box"><h2>SmileCraft Admin</h2><p style="margin-bottom:20px;">Secure Login</p>
  <input type="text" id="u" class="clay-input" placeholder="Username" /><input type="password" id="p" class="clay-input" placeholder="Password" />
  <button class="clay-btn" onclick="fetch('/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})}).then(r=>r.ok?location.href='/admin':alert('Invalid'))">Login</button></div>`)));

adminRouter.get('/', (req, res) => {
  if (!req.cookies.admin_token) return res.redirect('/admin/login');
  res.send(adminHTML('Dashboard', `
  <div class="dash">
    <div class="sidebar">
      <h2 style="color:var(--primary); margin-bottom:20px;"><i data-lucide="smile"></i> SmileCraft</h2>
      <div class="nav-item active"><i data-lucide="layout-dashboard"></i> Dashboard</div>
      <div class="nav-item" onclick="fetch('/admin/api/logout',{method:'POST'}).then(()=>location.reload())"><i data-lucide="log-out"></i> Logout</div>
    </div>
    <div class="main">
      <h1>Overview</h1><br>
      <div class="stats">
        <div class="clay-card"><h3>Total Bookings</h3><h2 id="st-tot">0</h2></div>
        <div class="clay-card"><h3>Pending</h3><h2 id="st-pen">0</h2></div>
        <div class="clay-card"><h3>Today's</h3><h2 id="st-tod">0</h2></div>
      </div>
      <div class="clay-card"><h2>Recent Appointments</h2>
        <table><thead><tr><th>Ref</th><th>Patient</th><th>Date/Time</th><th>Status</th><th>Action</th></tr></thead><tbody id="tb"></tbody></table>
      </div>
    </div>
  </div>
  <script>
    fetch('/admin/api/stats').then(r=>r.json()).then(d=>{ document.getElementById('st-tot').innerText=d.total; document.getElementById('st-pen').innerText=d.pending; document.getElementById('st-tod').innerText=d.todays; });
    const load = ()=> fetch('/admin/api/appointments').then(r=>r.json()).then(d=>{
      document.getElementById('tb').innerHTML = d.map(a=>\`<tr><td>\${a.bookingReference}</td><td>\${a.patientName}<br><small>\${a.patientPhone}</small></td><td>\${new Date(a.startAt).toLocaleString('en-US',{timeZone:'Asia/Kathmandu'})}</td><td>\${a.status}</td>
      <td><select class="clay-input" style="padding:8px; margin:0;" onchange="fetch('/admin/api/appointments/\${a._id}/status',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:this.value})}).then(load)">
      \${['Pending','Confirmed','Completed','Cancelled','No-show'].map(s=>\`<option \${a.status===s?'selected':''}>\${s}</option>\`).join('')}</select></td></tr>\`).join('');
    }); load();
  </script>`));
});

module.exports = adminRouter;