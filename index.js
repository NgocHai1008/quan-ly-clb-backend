// clb-backend/index.js
const express = require('express');
const cors = require('cors');
const http = require('http'); 
const { Server } = require("socket.io"); 
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000; 
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });






app.use(cors());
// Tăng giới hạn để nhận ảnh to
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- 1. KẾT NỐI MONGODB ---
const MONGO_URI = 'mongodb+srv://vvnnhanvan:vvnnhanvan@cluster0.lnwbmj8.mongodb.net/quanlyclb?retryWrites=true&w=majority&appName=Cluster0'; 

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Online'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// --- 2. SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: String, role: String, phone: String, status: { type: String, default: 'active' }, avatar: String
}));

// 🔥 CẬP NHẬT: Schema Post thêm authorAvatar 🔥
const Post = mongoose.model('Post', new mongoose.Schema({
  id: Number, 
  author: String, 
  authorAvatar: String, // <--- THÊM DÒNG NÀY
  role: String, 
  time: String, 
  content: String,
  image: String,
  likes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  commentList: { type: Array, default: [] } 
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  id: Number, text: String, sender: String, role: String, createdAt: { type: Date, default: Date.now }
}));

const Student = mongoose.model('Student', new mongoose.Schema({
  id: Number, name: String, tuition: { type: Boolean, default: false }
}));

const AttendanceLog = mongoose.model('AttendanceLog', new mongoose.Schema({
  date: String, pin: String, records: [{ id: Number, status: String }]
}));

const Notification = mongoose.model('Notification', new mongoose.Schema({
  targetUser: String, type: String, title: String, message: String, data: Object, isRead: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
}));

const Event = mongoose.model('Event', new mongoose.Schema({
  title: String, date: String, time: String, location: String, content: String
}));

// --- SOCKET IO ---
io.on('connection', (socket) => {
  socket.on('send_message', async (data) => {
      await Message.create({ id: data.id, text: data.text, sender: data.sender, role: data.role });
      io.emit('receive_message', data);
  });
  socket.on('payment_reminder', (data) => io.emit('payment_reminder', data));
  socket.on('new_notification', (data) => io.emit('new_notification', data));
  socket.on('refresh_attendance', (data) => io.emit('refresh_attendance', data));
});

// --- API BÀI VIẾT (ACTIVITY) - ĐÃ SỬA ---
app.get('/api/posts', async (req, res) => res.json(await Post.find().sort({ id: -1 })));

app.post('/api/posts', async (req, res) => { 
    // Nhận thêm authorAvatar từ Frontend
    const { content, author, role, image, authorAvatar } = req.body;
    await Post.create({ 
        id: Date.now(), 
        time: new Date().toLocaleDateString('vi-VN'),
        content, 
        author, 
        authorAvatar, // Lưu avatar người đăng
        role,
        image 
    }); 
    res.json({ success: true }); 
});

app.delete('/api/posts/:id', async (req, res) => { await Post.deleteOne({ id: req.params.id }); res.json({ success: true }); });
app.post('/api/posts/:id/like', async (req, res) => { await Post.updateOne({ id: req.params.id }, { $inc: { likes: 1 } }); res.json({success:true}); });
app.post('/api/posts/:id/comment', async (req, res) => { const p = await Post.findOne({ id: req.params.id }); if(p){ p.comments++; p.commentList.push(req.body); await p.save(); res.json({success:true, ...p._doc}); } else res.status(404).json({}); });

// --- CÁC API KHÁC (GIỮ NGUYÊN) ---
app.get('/api/chat', async (req, res) => res.json(await Message.find().sort({ createdAt: 1 })));
app.post('/api/login', async (req, res) => { const user = await User.findOne({ username: req.body.username, password: req.body.password }); if (!user) return res.status(401).json({ success: false, message: 'Sai thông tin' }); if (user.status === 'pending') return res.status(403).json({ success: false, message: 'Chờ duyệt' }); res.json({ success: true, user: { ...user._doc, password: '' } }); });
app.post('/api/register', async (req, res) => { if (await User.findOne({ username: req.body.username })) return res.status(400).json({ success: false, message: 'Trùng user' }); await User.create({ ...req.body, status: req.body.role === 'coach' ? 'pending' : 'active', avatar: `https://i.pravatar.cc/100?img=${Math.floor(Math.random() * 70)}` }); if (req.body.role === 'member') await Student.create({ id: Date.now(), name: req.body.name, tuition: false }); res.json({ success: true, message: 'Đăng ký thành công' }); });
app.post('/api/tuition', async (req, res) => { await Student.updateOne({ id: req.body.id }, { tuition: true }); res.json({ success: true }); });
app.post('/api/tuition/remind', async (req, res) => { const { studentName, qrUrl, amount } = req.body; await Notification.create({ targetUser: studentName, type: 'tuition', title: 'Thông báo đóng học phí', message: `Phí ${amount.toLocaleString('vi-VN')} VNĐ`, data: { qrUrl, amount } }); io.emit('new_notification', { targetUser: studentName }); res.json({ success: true, message: "Đã gửi thông báo!" }); });
app.get('/api/attendance', async (req, res) => { const log = await AttendanceLog.findOne({ date: req.query.date }); const all = await Student.find(); res.json({ list: all.map(s => ({ id: s.id, name: s.name, status: log?.records.find(r => r.id === s.id)?.status || 'Nghỉ' })), pin: log?.pin }); });
app.post('/api/attendance', async (req, res) => { let l = await AttendanceLog.findOne({ date: req.body.date }); if(!l) l = new AttendanceLog({ date: req.body.date, records: [] }); req.body.updates.forEach(u => { const i = l.records.findIndex(r => r.id === u.id); if(i>-1) l.records[i].status=u.status; else l.records.push({id:u.id, status:u.status}); }); await l.save(); io.emit('refresh_attendance', { date: req.body.date }); res.json({ success: true }); });
app.post('/api/attendance/pin', async (req, res) => { const pin = Math.floor(1000 + Math.random()*9000).toString(); await AttendanceLog.updateOne({ date: req.body.date }, { pin }, { upsert: true }); res.json({ success: true, pin }); });
app.post('/api/attendance/verify-pin', async (req, res) => { const l = await AttendanceLog.findOne({ date: req.body.date }); if(!l || l.pin !== req.body.pin) return res.json({ success: false, message: 'Sai PIN' }); const u = await User.findOne({ username: req.body.username }); const s = await Student.findOne({ name: u.name }); if(!s) return res.json({success:false}); const i = l.records.findIndex(r=>r.id===s.id); if(i>-1) l.records[i].status='Đi học'; else l.records.push({id:s.id, status:'Đi học'}); await l.save(); io.emit('refresh_attendance', { date: req.body.date }); res.json({ success: true }); });
app.get('/api/attendance/history', async (req, res) => { const user = await User.findOne({ username: req.query.username }); if (!user) return res.json({ count: 0, history: [] }); const student = await Student.findOne({ name: user.name }); if (!student) return res.json({ count: 0, history: [] }); const allLogs = await AttendanceLog.find(); const history = []; allLogs.forEach(log => { const record = log.records.find(r => r.id === student.id); if (record && record.status === 'Đi học') history.push({ date: log.date, status: 'Đi học' }); }); history.reverse(); res.json({ count: history.length, history }); });
app.put('/api/profile', async (req, res) => { try { const oldUser = await User.findOne({ username: req.body.username }); if (!oldUser) return res.status(404).json({ success: false }); const oldName = oldUser.name; const updatedUser = await User.findOneAndUpdate({ username: req.body.username }, { name: req.body.name, phone: req.body.phone, avatar: req.body.avatar }, { new: true }); await Student.updateMany({ name: oldName }, { name: req.body.name }); res.json({ success: true, user: { ...updatedUser._doc, password: '' } }); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/notifications', async (req, res) => { const u = await User.findOne({ username: req.query.username }); if (!u) return res.json([]); res.json(await Notification.find({ $or: [{ targetUser: u.name }, { targetUser: 'ALL' }] }).sort({ createdAt: -1 })); });
app.put('/api/notifications/read-all', async (req, res) => { const u = await User.findOne({ username: req.body.username }); if(u) await Notification.updateMany({ targetUser: u.name, isRead: false }, { $set: { isRead: true } }); res.json({ success: true }); });
app.get('/api/students', async (req, res) => res.json(await Student.find()));
app.get('/api/contacts', async (req, res) => res.json((await Student.find()).map(s => ({id: s.id, name: s.name, role: 'Thành viên'}))));
app.get('/api/events', async (req, res) => res.json(await Event.find().sort({ date: 1 })));
app.post('/api/events', async (req, res) => { await Event.create(req.body); res.json({ success: true }); });
app.delete('/api/events/:id', async (req, res) => { await Event.findByIdAndDelete(req.params.id); res.json({ success: true }); });
app.get('/api/admin/pending', async (req, res) => res.json(await User.find({ status: 'pending' })));
app.post('/api/admin/approve', async (req, res) => { if(req.body.action==='approve') await User.updateOne({username:req.body.username}, {status:'active'}); else await User.deleteOne({username:req.body.username}); res.json({success:true}); });
app.post('/api/forgot-password', async (req, res) => { const u = await User.findOne({username:req.body.username}); res.json(u ? {success:true, message: `Pass: ${u.password}`} : {success:false}); });
app.post('/api/notifications/send-all', async (req, res) => { const { title, message } = req.body; await Notification.create({ targetUser: 'ALL', type: 'system', title, message, data: {} }); io.emit('new_notification', { targetUser: 'ALL' }); res.json({ success: true }); });
app.put('/api/change-password', async (req, res) => { const { username, oldPass, newPass } = req.body; const user = await User.findOne({ username }); if (!user) return res.status(404).json({ success: false }); if (user.password !== oldPass) return res.json({ success: false, message: 'Sai mật khẩu cũ' }); user.password = newPass; await user.save(); res.json({ success: true }); });

async function createDefaultAdmin() { try { const adminExists = await User.findOne({ username: 'admin' }); if (!adminExists) await User.create({ username: 'admin', password: '123', name: 'Ban Chủ Nhiệm', role: 'admin', phone: '0909000111', status: 'active', avatar: 'https://i.pravatar.cc/150?img=11' }); } catch (e) {} }

server.listen(PORT, async () => { 
    console.log(`Server đang chạy tại port: ${PORT}`); 
    await createDefaultAdmin(); 
})