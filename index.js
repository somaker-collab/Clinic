require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const adminRouter = require('./admin');

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- DATABASE CONNECTION (Serverless Optimized) ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'smilecraft';
let cachedDb = null;

async function connectDB() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(MONGODB_URI);
  cachedDb = client.db(DB_NAME);
  await cachedDb.collection('appointments').createIndex({ startAt: 1, dentistId: 1 });
  await cachedDb.collection('appointments').createIndex({ bookingReference: 1 }, { unique: true });
  return cachedDb;
}

app.use(async (req, res, next) => {
  try { req.db = await connectDB(); next(); }
  catch (err) { res.status(500).send("Database connection failed."); }
});

// --- ROUTES ---
app.use('/admin', adminRouter);

app.get('/api/services', async (req, res) => {
  res.json(await req.db.collection('services').find({ active: true }).toArray());
});

app.get('/api/dentists', async (req, res) => {
  res.json(await req.db.collection('dentists').find({ active: true }).toArray());
});

app.get('/api/slots', async (req, res) => {
  const { date, serviceId, dentistId } = req.query; // date: YYYY-MM-DD
  if (!date || !serviceId) return res.status(400).json({ error: 'Missing params' });

  try {
    const service = await req.db.collection('services').findOne({ _id: new ObjectId(serviceId) });
    const dur = service ? service.durationMinutes : 30;

    // Convert local Nepal day boundaries to UTC for DB query
    const dayStart = new Date(`${date}T09:00:00+05:45`);
    const dayEnd = new Date(`${date}T18:00:00+05:45`);
    
    const query = { startAt: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'Cancelled' } };
    if (dentistId && dentistId !== 'any') query.dentistId = dentistId;
    const existing = await req.db.collection('appointments').find(query).toArray();

    const slots = [];
    let curr = new Date(dayStart);
    const now = new Date();

    while (curr < dayEnd) {
      const slotEnd = new Date(curr.getTime() + dur * 60000);
      if (slotEnd > dayEnd) break;

      if (curr > now) {
        const overlap = existing.some(a => {
          const aEnd = new Date(a.startAt.getTime() + dur * 60000);
          return (curr < aEnd && slotEnd > a.startAt);
        });
        if (!overlap) {
          slots.push({
            timeStr: curr.toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' }),
            timestamp: curr.toISOString()
          });
        }
      }
      curr = new Date(curr.getTime() + 30 * 60000);
    }
    res.json(slots);
  } catch (err) { res.status(500).json({ error: 'Error calculating slots' }); }
});

app.post('/api/book', async (req, res) => {
  const { serviceId, dentistId, startAt, patientName, patientPhone, patientEmail, patientNotes } = req.body;
  if (!serviceId || !startAt || !patientName || !patientPhone) return res.status(400).json({ error: 'Missing fields' });

  const bookingReference = 'SMILE-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const appointment = {
    bookingReference, serviceId, dentistId: dentistId === 'any' ? null : dentistId,
    startAt: new Date(startAt), patientName, patientPhone, patientEmail, patientNotes,
    status: 'Pending', createdAt: new Date(), updatedAt: new Date()
  };

  try {
    await req.db.collection('appointments').insertOne(appointment);
    res.json({ success: true, bookingReference });
  } catch (err) { res.status(500).json({ error: 'Booking failed' }); }
});

app.get('/api/my-booking/:ref', async (req, res) => {
  const appt = await req.db.collection('appointments').findOne({ bookingReference: req.params.ref.toUpperCase() });
  if (!appt) return res.status(404).json({ error: 'Not found' });
  const service = await req.db.collection('services').findOne({ _id: new ObjectId(appt.serviceId) });
  res.json({ ...appt, serviceName: service?.name || 'Service' });
});

// --- PUBLIC UI ---
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmileCraft Dental Care & Implant Center | Kathmandu, Nepal</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    :root { --pri:#27B8A5; --pri-dk:#159786; --sec:#77C8F4; --acc:#FF8F87; --lav:#DCD5FF; --bg:#F5F8FC; --surf:#FFFFFF; --txt:#203047; --mut:#718096;
      --sh-out: 12px 12px 24px #d1d9e6, -12px -12px 24px #ffffff; --sh-in: inset 6px 6px 12px #d1d9e6, inset -6px -6px 12px #ffffff; }
    * { margin:0; padding:0; box-sizing:border-box; font-family:'Plus Jakarta Sans',sans-serif; }
    body { background:var(--bg); color:var(--txt); line-height:1.6; scroll-behavior:smooth; }
    .container { max-width:1200px; margin:0 auto; padding:0 20px; }
    .text-center { text-align:center; }
    
    .anim-up { opacity:0; transform:translateY(30px); transition:all 0.8s ease; }
    .anim-up.visible { opacity:1; transform:translateY(0); }
    
    .clay-card { background:var(--surf); border-radius:32px; box-shadow:var(--sh-out); padding:32px; transition:transform 0.3s; }
    .clay-card:hover { transform:translateY(-5px); }
    .clay-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; background:var(--pri); color:#fff; padding:14px 32px; border-radius:50px; font-weight:700; border:none; cursor:pointer; box-shadow:6px 6px 16px rgba(39,184,165,0.4), -6px -6px 16px #fff; text-decoration:none; transition:0.2s; }
    .clay-btn.sec { background:var(--surf); color:var(--txt); box-shadow:var(--sh-out); }
    .clay-btn:active { box-shadow:var(--sh-in); transform:scale(0.98); }
    .clay-input { width:100%; padding:16px 24px; border:none; border-radius:20px; background:var(--bg); box-shadow:var(--sh-in); font-size:1rem; outline:none; }
    
    header { position:sticky; top:0; z-index:100; background:rgba(245,248,252,0.9); backdrop-filter:blur(10px); padding:15px 0; }
    .nav { display:flex; justify-content:space-between; align-items:center; }
    .logo { font-size:1.5rem; font-weight:800; color:var(--pri-dk); display:flex; align-items:center; gap:10px; text-decoration:none; }
    .links { display:flex; gap:30px; align-items:center; } .links a { text-decoration:none; color:var(--txt); font-weight:600; }
    
    .hero { padding:80px 0; display:grid; grid-template-columns:1fr 1fr; gap:60px; align-items:center; }
    .hero h1 { font-size:3.5rem; line-height:1.1; margin-bottom:20px; font-weight:800; }
    .hero p { font-size:1.2rem; color:var(--mut); margin-bottom:30px; }
    .hero-img { position:relative; text-align:center; }
    .hero-img img { width:100%; max-width:500px; border-radius:32px; box-shadow:var(--sh-out); animation:float 6s ease-in-out infinite; }
    @keyframes float { 0%, 100%{transform:translateY(0);} 50%{transform:translateY(-15px);} }
    
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:32px; margin-top:40px; }
    
    /* Booking Form */
    .stepper { display:flex; justify-content:space-between; margin-bottom:40px; position:relative; }
    .stepper::before { content:''; position:absolute; top:50%; left:0; right:0; height:4px; background:var(--surf); box-shadow:var(--sh-in); z-index:1; transform:translateY(-50%); }
    .step-ind { width:40px; height:40px; background:var(--surf); box-shadow:var(--sh-out); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; z-index:2; color:var(--mut); }
    .step-ind.active { background:var(--pri); color:#fff; box-shadow:0 0 0 4px rgba(39,184,165,0.2); }
    .step-content { display:none; } .step-content.active { display:block; animation:fadeIn 0.4s; }
    @keyframes fadeIn { from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }
    
    .radio-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }
    .radio-lbl { display:block; padding:20px; background:var(--surf); border-radius:20px; box-shadow:var(--sh-out); cursor:pointer; text-align:center; font-weight:600; border:2px solid transparent; transition:0.2s; }
    input[type="radio"] { display:none; }
    input[type="radio"]:checked + .radio-lbl { border-color:var(--pri); box-shadow:var(--sh-in); color:var(--pri-dk); }
    .form-group { margin-bottom:20px; text-align:left; } .form-group label { font-weight:600; display:block; margin-bottom:8px; }
    
    footer { background:var(--surf); padding:60px 0 20px; margin-top:80px; }
    @media(max-width:900px){ .hero{grid-template-columns:1fr; text-align:center;} .links{display:none;} }
  </style>
</head>
<body>
  <header>
    <div class="container nav">
      <a href="#" class="logo"><i data-lucide="smile" style="color:var(--pri)"></i> SmileCraft</a>
      <div class="links"><a href="#services">Services</a><a href="#dentists">Dentists</a><a href="#faq">FAQ</a><a href="#book" class="clay-btn" style="padding:10px 24px">Book Now</a></div>
    </div>
  </header>

  <section class="container hero anim-up">
    <div>
      <h1>Your Healthier Smile Starts Here.</h1>
      <p>Premium, pain-free dental care in New Baneshwor, Kathmandu. Book your appointment online today.</p>
      <div style="display:flex; gap:16px; flex-wrap:wrap;">
        <a href="#book" class="clay-btn">Book Appointment <i data-lucide="arrow-right"></i></a>
        <a href="#services" class="clay-btn sec">Explore Services</a>
      </div>
    </div>
    <div class="hero-img">
      <img src="https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&q=80&w=600" alt="Clinic">
    </div>
  </section>

  <section id="services" class="container anim-up" style="padding:80px 0;">
    <div class="text-center"><h2 style="font-size:2.5rem;">Our Services</h2><p style="color:var(--mut);">Indicative pricing. Finalized after exam.</p></div>
    <div class="grid" id="srv-grid"></div>
  </section>
  
  <section id="dentists" class="container anim-up" style="padding:40px 0;">
    <div class="text-center"><h2 style="font-size:2.5rem;">Meet Our Dentists</h2><p style="color:var(--mut);">Fictional demonstration profiles.</p></div>
    <div class="grid" id="dent-grid"></div>
  </section>

  <section id="book" class="container anim-up" style="padding:80px 0;">
    <div class="text-center" style="margin-bottom:40px;"><h2 style="font-size:2.5rem;">Book Your Appointment</h2></div>
    <div class="clay-card" style="max-width:800px; margin:0 auto;">
      <div class="stepper">
        <div class="step-ind active" id="i1">1</div><div class="step-ind" id="i2">2</div><div class="step-ind" id="i3">3</div><div class="step-ind" id="i4">4</div>
      </div>
      <form id="bk-form" onsubmit="event.preventDefault(); submitBook();">
        <div class="step-content active" id="s1">
          <h3 style="margin-bottom:20px;">Select Service</h3>
          <div class="radio-grid" id="fsrv"></div>
          <button type="button" class="clay-btn" style="margin-top:30px; float:right;" onclick="nxt(1)">Next <i data-lucide="arrow-right"></i></button>
        </div>
        <div class="step-content" id="s2">
          <h3 style="margin-bottom:20px;">Select Dentist</h3>
          <div class="radio-grid" id="fden"></div>
          <div style="display:flex; justify-content:space-between; margin-top:30px;">
            <button type="button" class="clay-btn sec" onclick="prv(2)"><i data-lucide="arrow-left"></i> Back</button>
            <button type="button" class="clay-btn" onclick="nxt(2)">Next <i data-lucide="arrow-right"></i></button>
          </div>
        </div>
        <div class="step-content" id="s3">
          <h3 style="margin-bottom:20px;">Date & Time (Nepal Time)</h3>
          <div class="form-group"><label>Date</label><input type="date" id="b-date" class="clay-input" onchange="fetchSlots()"></div>
          <div class="form-group"><label>Available Slots</label><div class="radio-grid" id="fslot" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr));">Select a date</div></div>
          <div style="display:flex; justify-content:space-between; margin-top:30px;">
            <button type="button" class="clay-btn sec" onclick="prv(3)"><i data-lucide="arrow-left"></i> Back</button>
            <button type="button" class="clay-btn" onclick="nxt(3)">Next <i data-lucide="arrow-right"></i></button>
          </div>
        </div>
        <div class="step-content" id="s4">
          <h3 style="margin-bottom:20px;">Patient Info</h3>
          <div class="form-group"><label>Name *</label><input type="text" id="b-name" class="clay-input" required></div>
          <div class="form-group"><label>Phone (Nepal) *</label><input type="tel" id="b-phone" class="clay-input" required></div>
          <div class="form-group"><label>Notes</label><input type="text" id="b-note" class="clay-input"></div>
          <div style="display:flex; justify-content:space-between; margin-top:30px;">
            <button type="button" class="clay-btn sec" onclick="prv(4)"><i data-lucide="arrow-left"></i> Back</button>
            <button type="submit" class="clay-btn" id="sub-btn">Confirm <i data-lucide="check"></i></button>
          </div>
        </div>
        <div class="step-content text-center" id="s-succ">
          <i data-lucide="check-circle" style="color:var(--pri); width:80px; height:80px; margin:20px auto;"></i>
          <h2>Booking Confirmed!</h2>
          <div style="background:var(--bg); padding:20px; border-radius:20px; box-shadow:var(--sh-in); margin:20px auto; max-width:300px; font-size:1.5rem; font-weight:800; color:var(--pri-dk);" id="succ-ref"></div>
          <p>Please keep this reference. We will contact you soon.</p>
          <button type="button" class="clay-btn" style="margin-top:20px;" onclick="location.reload()">Done</button>
        </div>
      </form>
    </div>
  </section>

  <!-- My Booking Lookup -->
  <section class="container anim-up" style="padding:40px 0;">
    <div class="clay-card text-center" style="max-width:500px; margin:0 auto;">
      <h3>Manage Booking</h3>
      <p style="color:var(--mut); margin-bottom:15px; font-size:0.9rem;">Enter your SMILE-XXX reference</p>
      <input type="text" id="ref-input" class="clay-input" placeholder="SMILE-...">
      <button class="clay-btn" onclick="lookup()">Check Status</button>
      <div id="lk-res" style="margin-top:15px; font-weight:700;"></div>
    </div>
  </section>

  <footer>
    <div class="container text-center" style="color:var(--mut);">
      <h3 style="color:var(--txt); margin-bottom:10px;"><i data-lucide="smile"></i> SmileCraft Dental Care</h3>
      <p>New Baneshwor, Kathmandu, Nepal | +977-9800000001</p>
      <p style="font-size:0.8rem; margin-top:20px; font-style:italic;">*This is a fictional demonstration application.</p>
    </div>
  </footer>

  <script>
    lucide.createIcons();
    const obs = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting) e.target.classList.add('visible'); }));
    document.querySelectorAll('.anim-up').forEach(el => obs.observe(el));

    let state = { srv:null, den:null, slot:null };
    document.getElementById('b-date').min = new Date().toISOString().split('T')[0];

    // Load Data
    Promise.all([fetch('/api/services').then(r=>r.json()), fetch('/api/dentists').then(r=>r.json())]).then(([srvs, dens]) => {
      // Render Services
      document.getElementById('srv-grid').innerHTML = srvs.map(s=>\`<div class="clay-card text-center"><div style="width:60px;height:60px;background:var(--lav);border-radius:50%;margin:0 auto 15px;display:flex;align-items:center;justify-content:center;"><i data-lucide="activity"></i></div><h3>\${s.name}</h3><p style="color:var(--pri);font-weight:700;margin:10px 0;">\${s.priceLabel}</p><p style="color:var(--mut);font-size:0.9rem;margin-bottom:15px;">\${s.description}</p><button class="clay-btn" onclick="document.getElementById('book').scrollIntoView()">Book</button></div>\`).join('');
      document.getElementById('fsrv').innerHTML = srvs.map(s=>\`<div><input type="radio" name="srv" id="rs\${s._id}" value="\${s._id}"><label for="rs\${s._id}" class="radio-lbl">\${s.name}</label></div>\`).join('');
      
      // Render Dentists
      document.getElementById('dent-grid').innerHTML = dens.map(d=>\`<div class="clay-card text-center"><h3>\${d.name}</h3><p style="color:var(--mut);margin-bottom:10px;">\${d.specialty}</p><p style="font-size:0.9rem;">\${d.bio}</p></div>\`).join('');
      document.getElementById('fden').innerHTML = \`<div><input type="radio" name="den" id="rdany" value="any" checked><label for="rdany" class="radio-lbl">Any Available Dentist</label></div>\` + dens.map(d=>\`<div><input type="radio" name="den" id="rd\${d._id}" value="\${d._id}"><label for="rd\${d._id}" class="radio-lbl">\${d.name}</label></div>\`).join('');
      lucide.createIcons();
    });

    // Form Steps
    function nxt(n) {
      if(n===1) { state.srv = document.querySelector('input[name="srv"]:checked')?.value; if(!state.srv) return alert('Select a service'); }
      if(n===2) { state.den = document.querySelector('input[name="den"]:checked')?.value; }
      if(n===3) { state.slot = document.querySelector('input[name="slt"]:checked')?.value; if(!state.slot) return alert('Select a slot'); }
      document.getElementById('s'+n).classList.remove('active'); document.getElementById('s'+(n+1)).classList.add('active');
      document.getElementById('i'+n).classList.remove('active'); document.getElementById('i'+(n+1)).classList.add('active');
    }
    function prv(n) {
      document.getElementById('s'+n).classList.remove('active'); document.getElementById('s'+(n-1)).classList.add('active');
      document.getElementById('i'+n).classList.remove('active'); document.getElementById('i'+(n-1)).classList.add('active');
    }

    async function fetchSlots() {
      const d = document.getElementById('b-date').value;
      if(!d || !state.srv) return;
      document.getElementById('fslot').innerHTML = 'Loading...';
      const res = await fetch(\`/api/slots?date=\${d}&serviceId=\${state.srv}&dentistId=\${state.den}\`);
      const slots = await res.json();
      if(slots.length===0) { document.getElementById('fslot').innerHTML = '<div style="color:var(--acc);">No slots available</div>'; return; }
      document.getElementById('fslot').innerHTML = slots.map((s,i)=>\`<div><input type="radio" name="slt" id="sl\${i}" value="\${s.timestamp}"><label for="sl\${i}" class="radio-lbl" style="padding:10px;">\${s.timeStr}</label></div>\`).join('');
    }

    async function submitBook() {
      document.getElementById('sub-btn').disabled = true; document.getElementById('sub-btn').innerText = 'Booking...';
      const payload = { serviceId: state.srv, dentistId: state.den, startAt: state.slot, patientName: document.getElementById('b-name').value, patientPhone: document.getElementById('b-phone').value, patientNotes: document.getElementById('b-note').value };
      const res = await fetch('/api/book', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const data = await res.json();
      if(data.success) {
        document.getElementById('s4').classList.remove('active'); document.getElementById('s-succ').classList.add('active');
        document.getElementById('succ-ref').innerText = data.bookingReference;
      } else { alert('Error: '+data.error); document.getElementById('sub-btn').disabled = false; document.getElementById('sub-btn').innerText = 'Confirm'; }
    }

    async function lookup() {
      const ref = document.getElementById('ref-input').value;
      if(!ref) return;
      const res = await fetch('/api/my-booking/'+ref);
      if(res.ok) {
        const d = await res.json();
        document.getElementById('lk-res').innerHTML = \`<span style="color:var(--pri)">Found! Status: \${d.status}</span><br><small>\${d.serviceName} on \${new Date(d.startAt).toLocaleString()}</small>\`;
      } else { document.getElementById('lk-res').innerHTML = '<span style="color:var(--acc)">Not Found</span>'; }
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;