// clb-backend/index.js
const express = require('express');
const cors = require('cors');
const http = require('http'); 
const { Server } = require("socket.io"); 
const mongoose = require('mongoose');
const crypto = require('crypto');
const XLSX = require('xlsx'); 

const app = express();
const PORT = process.env.PORT || 3000; 
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Tăng giới hạn dung lượng để upload ảnh
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- 1. KẾT NỐI MONGODB ---
const MONGO_URI = 'mongodb+srv://vvnnhanvan:vvnnhanvan@cluster0.lnwbmj8.mongodb.net/quanlyclb?retryWrites=true&w=majority&appName=Cluster0'; 

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Online'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// --- 2. KHAI BÁO SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: String, role: String, phone: String, status: { type: String, default: 'active' }, avatar: String
}));

const Post = mongoose.model('Post', new mongoose.Schema({
  id: Number, author: String, authorAvatar: String, role: String, time: String, content: String, image: String,
  likes: { type: Number, default: 0 }, comments: { type: Number, default: 0 }, commentList: { type: Array, default: [] } 
}));

// 🔥 FIX: Message Schema có trường 'image'
const Message = mongoose.model('Message', new mongoose.Schema({
  id: Number, 
  text: String, 
  image: String, // <-- LƯU ẢNH BASE64
  sender: String, 
  role: String, 
  avatar: String, 
  createdAt: { type: Date, default: Date.now }
}));

const Student = mongoose.model('Student', new mongoose.Schema({
  id: Number, name: String, tuitionPaidMonths: { type: [String], default: [] }
}));

const AttendanceLog = mongoose.model('AttendanceLog', new mongoose.Schema({
  date: String, pin: String, records: [{ id: Number, status: String }]
}));

// 🔥 FIX: Notification Schema
const Notification = mongoose.model('Notification', new mongoose.Schema({
  targetUser: String, 
  type: String, 
  title: String, 
  message: String, 
  data: { type: mongoose.Schema.Types.Mixed, default: {} }, 
  isRead: { type: Boolean, default: false }, 
  createdAt: { type: Date, default: Date.now }
}));

const Event = mongoose.model('Event', new mongoose.Schema({
  title: String, date: String, time: String, location: String, content: String
}));

// --- HELPER CHUNG ---
const generatePassword = (length = 6) => crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);

async function createDefaultAdmin() {
    try {
        const adminExists = await User.findOne({ username: 'admin' });
        if (!adminExists) {
            await User.create({ username: 'admin', password: '123', name: 'Ban Chủ Nhiệm', role: 'admin', phone: '0909000111', status: 'active', avatar: 'https://i.pravatar.cc/150?img=11' });
            console.log("✅ Admin mặc định đã được tạo.");
        }
    } catch (e) { console.log("Lỗi Admin: " + e.message); }
}

const processMemberImport = async (membersToImport, res) => {
    const results = [];
    const existingStudentsCount = await Student.countDocuments();
    let index = existingStudentsCount + 1;
    for (const member of membersToImport) {
        const studentName = member.name.trim();
        if (!studentName) continue;
        const username = `CLB${String(index).padStart(3, '0')}`;
        const password = generatePassword(6);
        const newId = Date.now() + index;
        try {
            const userExists = await User.findOne({ username });
            if (userExists) { results.push({ name: studentName, status: 'error', message: 'Trùng tên đăng nhập.' }); index++; continue; }
            await User.create({ username, password, name: studentName, role: 'member', status: 'active', phone: '', avatar: `https://i.pravatar.cc/100?img=${Math.floor(Math.random() * 70)}` });
            await Student.create({ id: newId, name: studentName, tuitionPaidMonths: [] });
            results.push({ name: studentName, username, password, status: 'success' });
        } catch (e) { results.push({ name: studentName, status: 'error', message: 'Lỗi DB' }); }
        index++;
    }
    return res.json({ success: true, results: results });
}

// --- 3. API ROUTES ---

// GỬI THÔNG BÁO NHẮC NỢ
app.post('/api/tuition/remind', async (req, res) => { 
    try {
        const { studentName, qrUrl, amount, month } = req.body; 
        const notificationData = { qrUrl: qrUrl, amount: amount };

        await Notification.create({ 
            targetUser: studentName, type: 'tuition', title: `Thu học phí tháng ${month || 'này'}`, 
            message: `Vui lòng thanh toán phí tháng ${month || ''}. Số tiền: ${parseInt(amount).toLocaleString('vi-VN')} VNĐ`, data: notificationData 
        }); 
        
        io.emit('new_notification', { targetUser: studentName }); 
        res.json({ success: true, message: "Đã gửi thông báo!" }); 
    } catch (e) {
        console.error("Lỗi gửi:", e);
        res.status(500).json({ success: false });
    }
});

// CHAT (Gửi tin nhắn + ẢNH)
app.post('/api/chat', async (req, res) => {
    try {
        const { text, image, sender, role, avatar } = req.body; 
        const newMessage = await Message.create({
            id: Date.now(), text, image, sender, role, avatar, createdAt: new Date()
        });
        io.emit('receive_message', newMessage);
        res.json({ success: true, data: newMessage });
    } catch (e) { 
        console.error("Lỗi chat:", e);
        res.status(500).json({ success: false }); 
    }
});

// CÁC API KHÁC
app.post('/api/tuition', async (req, res) => { 
    try {
        const { id, month } = req.body; 
        let result = await Student.updateOne({ id: parseInt(id) }, { $addToSet: { tuitionPaidMonths: month } });
        if (result.matchedCount === 0) result = await Student.updateOne({ id: String(id) }, { $addToSet: { tuitionPaidMonths: month } });
        if (result.matchedCount > 0) res.json({ success: true });
        else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});
app.get('/api/students/:id', async (req, res) => {
    try {
        let s = await Student.findOne({ id: parseInt(req.params.id) });
        if (!s) s = await Student.findOne({ id: req.params.id });
        res.json(s || { tuitionPaidMonths: [] });
    } catch (e) { res.status(500).json({ tuitionPaidMonths: [] }); }
});
app.get('/api/chat', async (req, res) => res.json(await Message.find().sort({ createdAt: 1 })));
app.get('/api/posts', async (req, res) => res.json(await Post.find().sort({ id: -1 })));
app.post('/api/posts', async (req, res) => { const { content, author, role, image, authorAvatar } = req.body; await Post.create({ id: Date.now(), time: new Date().toLocaleDateString('vi-VN'), content, author, authorAvatar, role, image }); res.json({ success: true }); });
app.delete('/api/posts/:id', async (req, res) => { await Post.deleteOne({ id: req.params.id }); res.json({ success: true }); });
app.post('/api/posts/:id/like', async (req, res) => { await Post.updateOne({ id: req.params.id }, { $inc: { likes: 1 } }); res.json({success:true}); });
app.post('/api/posts/:id/comment', async (req, res) => { const p = await Post.findOne({ id: req.params.id }); if(p){ p.comments++; p.commentList.push(req.body); await p.save(); res.json({success:true, ...p._doc}); } else res.status(404).json({}); });
app.post('/api/login', async (req, res) => { const user = await User.findOne({ username: req.body.username, password: req.body.password }); if (!user) return res.status(401).json({ success: false, message: 'Sai thông tin' }); if (user.status === 'pending') return res.status(403).json({ success: false, message: 'Chờ duyệt' }); res.json({ success: true, user: { ...user._doc, password: '' } }); });
app.post('/api/register', async (req, res) => { if (await User.findOne({ username: req.body.username })) return res.status(400).json({ success: false, message: 'Trùng user' }); await User.create({ ...req.body, status: req.body.role === 'coach' ? 'pending' : 'active', avatar: `https://i.pravatar.cc/100?img=${Math.floor(Math.random() * 70)}` }); if (req.body.role === 'member') await Student.create({ id: Date.now(), name: req.body.name, tuitionPaidMonths: [] }); res.json({ success: true, message: 'Đăng ký thành công' }); });
app.get('/api/attendance', async (req, res) => { const log = await AttendanceLog.findOne({ date: req.query.date }); const all = await Student.find(); res.json({ list: all.map(s => ({ id: s.id, name: s.name, status: log?.records.find(r => r.id === s.id)?.status || 'Nghỉ' })), pin: log?.pin }); });
app.post('/api/attendance', async (req, res) => { let l = await AttendanceLog.findOne({ date: req.body.date }); if(!l) l = new AttendanceLog({ date: req.body.date, records: [] }); req.body.updates.forEach(u => { const i = l.records.findIndex(r => r.id === u.id); if(i>-1) l.records[i].status=u.status; else l.records.push({id:u.id, status:u.status}); }); await l.save(); io.emit('refresh_attendance', { date: req.body.date }); res.json({ success: true }); });
app.post('/api/attendance/pin', async (req, res) => { const pin = Math.floor(1000 + Math.random()*9000).toString(); await AttendanceLog.updateOne({ date: req.body.date }, { pin }, { upsert: true }); res.json({ success: true, pin }); });
app.post('/api/attendance/verify-pin', async (req, res) => { const l = await AttendanceLog.findOne({ date: req.body.date }); if(!l || l.pin !== req.body.pin) return res.json({ success: false, message: 'Sai PIN' }); const u = await User.findOne({ username: req.body.username }); if (!u) return res.json({ success: false, message: 'Lỗi: Không tìm thấy hồ sơ người dùng.' }); const s = await Student.findOne({ name: u.name }); if(!s) return res.json({success:false, message: 'Lỗi: Không tìm thấy hồ sơ học viên.'}); const i = l.records.findIndex(r=>r.id===s.id); if(i>-1) l.records[i].status='Đi học'; else l.records.push({id:s.id, status:'Đi học'}); await l.save(); io.emit('refresh_attendance', { date: req.body.date }); res.json({ success: true }); });
app.get('/api/attendance/history', async (req, res) => { const user = await User.findOne({ username: req.query.username }); if (!user) return res.json({ count: 0, history: [] }); const student = await Student.findOne({ name: user.name }); if (!student) return res.json({ count: 0, history: [] }); const allLogs = await AttendanceLog.find(); const history = []; allLogs.forEach(log => { const record = log.records.find(r => r.id === student.id); if (record && record.status === 'Đi học') history.push({ date: log.date, status: 'Đi học' }); }); history.reverse(); res.json({ count: history.length, history }); });
app.put('/api/profile', async (req, res) => { try { const { username, avatar, name: newName } = req.body; const oldUser = await User.findOne({ username }); if (!oldUser) return res.status(404).json({ success: false }); const oldName = oldUser.name; const updatedUser = await User.findOneAndUpdate({ username }, { name: newName, phone: req.body.phone, avatar: avatar }, { new: true }); await Student.updateMany({ name: oldName }, { name: updatedUser.name }); if (avatar) { await Post.updateMany({ author: oldName }, { $set: { authorAvatar: avatar, author: updatedUser.name } }); } res.json({ success: true, user: { ...updatedUser._doc, password: '' } }); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/notifications', async (req, res) => { const u = await User.findOne({ username: req.query.username }); if (!u) return res.json([]); res.json(await Notification.find({ $or: [{ targetUser: u.name }, { targetUser: 'ALL' }] }).sort({ createdAt: -1 })); });
app.put('/api/notifications/read-all', async (req, res) => { const u = await User.findOne({ username: req.body.username }); if(u) await Notification.updateMany({ targetUser: u.name, isRead: false }, { $set: { isRead: true } }); res.json({ success: true }); });
app.get('/api/students', async (req, res) => res.json(await Student.find()));
app.get('/api/events', async (req, res) => res.json(await Event.find().sort({ date: 1 })));
app.post('/api/events', async (req, res) => { await Event.create(req.body); res.json({ success: true }); });
app.delete('/api/events/:id', async (req, res) => { await Event.findByIdAndDelete(req.params.id); res.json({ success: true }); });
app.get('/api/admin/pending', async (req, res) => res.json(await User.find({ status: 'pending' })));
app.get('/api/admin/members-full', async (req, res) => { const students = await Student.find(); const users = await User.find(); const fullList = students.map(s => { const u = users.find(user => user.name === s.name); return { id: s.id, name: s.name, username: u?.username || 'Chưa có TK', phone: u?.phone || 'Chưa cập nhật', avatar: u?.avatar || 'https://i.pravatar.cc/100?img=1', role: u?.role || 'member' }; }); res.json(fullList); });
app.delete('/api/admin/members/:id', async (req, res) => { try { const studentId = parseInt(req.params.id); const student = await Student.findOne({ id: studentId }); if (student) { await User.deleteOne({ name: student.name }); await Student.deleteOne({ id: studentId }); res.json({ success: true, message: 'Đã xóa thành viên và tài khoản.' }); } else { res.status(404).json({ success: false, message: 'Không tìm thấy học viên.' }); } } catch (e) { res.status(500).json({ success: false, message: 'Lỗi server.' }); } });
app.post('/api/admin/approve', async (req, res) => { if(req.body.action==='approve') await User.updateOne({username:req.body.username}, {status:'active'}); else await User.deleteOne({username:req.body.username}); res.json({success:true}); });
app.post('/api/admin/import-excel', async (req, res) => { const { base64Data } = req.body; try { const buffer = Buffer.from(base64Data, 'base64'); const workbook = XLSX.read(buffer, { type: 'buffer' }); const sheetName = workbook.SheetNames[0]; const worksheet = workbook.Sheets[sheetName]; const dataArray = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); const members = dataArray.slice(1).map(row => ({ name: row[0] ? String(row[0]) : '' })).filter(m => m.name.trim() !== ''); return processMemberImport(members, res); } catch (error) { return res.status(500).json({ success: false }); } });
app.post('/api/admin/import-members', async (req, res) => { return processMemberImport(req.body.members, res); });
app.post('/api/notifications/send-all', async (req, res) => { const { title, message } = req.body; await Notification.create({ targetUser: 'ALL', type: 'system', title, message, data: {} }); io.emit('new_notification', { targetUser: 'ALL' }); res.json({ success: true }); });
app.put('/api/change-password', async (req, res) => { const { username, oldPass, newPass } = req.body; const user = await User.findOne({ username }); if (!user) return res.status(404).json({ success: false }); if (user.password !== oldPass) return res.json({ success: false, message: 'Sai mật khẩu cũ' }); user.password = newPass; await user.save(); res.json({ success: true }); });

server.listen(PORT, async () => { console.log(`Server đang chạy tại port: ${PORT}`); await createDefaultAdmin(); });