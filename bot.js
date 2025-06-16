const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config(); // Memuat variabel lingkungan dari .env file jika ada

console.log("Memulai bot...");

// --- Initialize Gemini AI ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// --- Struktur Data & Sesi ---
// Key: Nomor telepon ternormalisasi, Value: Object { nama: '...', nip: '...' }
let dosenDataMap = new Map();
// Key: ID pengirim, Value: Object { step: '...', data: {} }
let userSessions = new Map();

// --- Fungsi Utilitas ---
function normalizePhoneNumber(number) {
  if (!number || typeof number !== "string") return null;
  number = number.replace(/\D/g, "");
  if (number.startsWith("0")) {
    return "62" + number.substring(1);
  }
  if (number.startsWith("62")) {
    return number;
  }
  if (number.startsWith("8")) {
    return "62" + number;
  }
  console.warn(`Tidak dapat menormalisasi nomor: ${number}`);
  return null;
}

function loadDosenDatabase() {
  try {
    const filePath = "dosen.json";
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File database ${filePath} tidak ditemukan!`);
      dosenDataMap = new Map();
      return;
    }
    const data = fs.readFileSync(filePath, "utf8");
    const dosenArray = JSON.parse(data);
    dosenDataMap = new Map();
    dosenArray.forEach((dosen) => {
      if (dosen && dosen.nama && dosen.nip && dosen.nomor_telepon) {
        const normalizedNumber = normalizePhoneNumber(dosen.nomor_telepon);
        if (normalizedNumber) {
          dosenDataMap.set(normalizedNumber, { nama: dosen.nama, nip: dosen.nip });
        } else {
          console.warn(`Nomor tidak valid: ${dosen.nomor_telepon} untuk ${dosen.nama}`);
        }
      } else {
        console.warn("Entri dosen tidak lengkap ditemukan dan dilewati:", dosen);
      }
    });
    console.log(`Database dosen dimuat: ${dosenDataMap.size} entri valid.`);
  } catch (err) {
    console.error("Gagal memuat atau memproses database dosen:", err);
    dosenDataMap = new Map();
  }
}

console.log("Menginisialisasi WhatsApp Client...");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

console.log("Client dibuat. Menunggu event...");

client.on("qr", (qr) => {
  console.log("QR Code diterima, pindai dengan WhatsApp Anda:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("-----------------------------------");
  console.log("       CLIENT WHATSAPP SIAP!       ");
  console.log("-----------------------------------");
  loadDosenDatabase(); // Muat database setelah client siap
});

client.on("authenticated", () => {
  console.log("Autentikasi Berhasil!");
});

client.on("auth_failure", (msg) => {
  console.error("-----------------------------------");
  console.error("     AUTENTIKASI GAGAL!            ");
  console.error("-----------------------------------");
  console.error("Pesan:", msg);
  console.error("Hapus folder .wwebjs_auth dan coba jalankan lagi.");
});

client.on("disconnected", (reason) => {
  console.warn("-----------------------------------");
  console.warn("      CLIENT TERPUTUS!            ");
  console.warn("-----------------------------------");
  console.warn("Alasan:", reason);
});

// --- Memproses Pesan Masuk (Logika Utama) ---
client.on("message", async (msg) => {
  const chat = await msg.getChat();
  if (chat.isGroup || msg.isStatus || msg.fromMe) return;

  const sender = msg.from;
  const messageBody = msg.body.trim();
  console.log(`[Pesan Masuk] Dari ${sender}: ${messageBody}`);

  if (!userSessions.has(sender)) {
    userSessions.set(sender, { step: "menu", data: {} });
  }

  const userSession = userSessions.get(sender);

  if (["menu", "mulai", "start"].includes(messageBody.toLowerCase())) {
    userSession.step = "menu";
    userSession.data = {};
  }

  // State Machine untuk alur interaksi
  switch (userSession.step) {
    case "menu":
      const menuMessage = "🤖 *Selamat datang di Bot Verifikasi SOCENG*\n\nSilakan pilih opsi:\n\n*1* - Cek Nomor Dosen\n*2* - Cek Pesan (Analisis Spam)\n*3* - Cek Nomor + Analisis Pesan\n\nKetik angka pilihan Anda:";
      await client.sendMessage(sender, menuMessage);
      userSession.step = "waiting_menu_choice";
      break;

    case "waiting_menu_choice":
      const choice = messageBody.trim();
      if (choice === "1") {
        userSession.step = "waiting_number";
        await client.sendMessage(sender, "📱 *Cek Nomor Dosen*\n\nSilakan kirim nomor telepon yang ingin Anda verifikasi:");
      } else if (choice === "2") {
        userSession.step = "waiting_message";
        await client.sendMessage(sender, "💬 *Analisis Pesan*\n\nSilakan kirim pesan yang ingin Anda analisis:");
      } else if (choice === "3") {
        userSession.step = "waiting_number_then_message";
        await client.sendMessage(sender, "📱💬 *Cek Nomor + Analisis Pesan*\n\nLangkah 1: Silakan kirim nomor telepon:");
      } else {
        await client.sendMessage(sender, "❌ *Pilihan Tidak Valid*\n\nKetik 'menu' untuk melihat pilihan lagi.");
      }
      break;

    case "waiting_number":
      const normalizedNumber = normalizePhoneNumber(messageBody);
      if (normalizedNumber && dosenDataMap.has(normalizedNumber)) {
        const dosenInfo = dosenDataMap.get(normalizedNumber);
        await client.sendMessage(sender, `✅ *Terverifikasi Dosen ITS*\n\n*Nama:* ${dosenInfo.nama}\n*NIP:* ${dosenInfo.nip}\n\n---\nKetik 'menu' untuk kembali.`);
      } else if (normalizedNumber) {
        await client.sendMessage(sender, `❌ *Tidak Terdaftar*\n\nNomor *${messageBody}* tidak ditemukan.\n\n---\nKetik 'menu' untuk kembali.`);
      } else {
        await client.sendMessage(sender, `⚠️ *Format Nomor Salah*\n\nSilakan coba lagi.`);
      }
      userSession.step = "menu";
      break;

    case "waiting_message":
      const prompt = `Analisis pesan ini: "${messageBody}". Tentukan apakah ini scam/spam. Jawab "Ya/Tidak, pesan ini adalah/bukan penipuan karena [alasan singkat]." dalam satu paragraf biasa.`;
      const result = await model.generateContent(prompt);
      await client.sendMessage(sender, `🤖 *Analisis Pesan SOCENG*\n\n${(await result.response).text()}\n\n---\nKetik 'menu' untuk kembali.`);
      userSession.step = "menu";
      break;

    case "waiting_number_then_message":
      if (!userSession.data.numberResult) {
        const normNum = normalizePhoneNumber(messageBody);
        if (normNum) {
          userSession.data.numberResult = dosenDataMap.has(normNum)
            ? `✅ *Terverifikasi Dosen ITS*\n\n*Nama:* ${dosenDataMap.get(normNum).nama}\n*NIP:* ${dosenDataMap.get(normNum).nip}`
            : `❌ *Tidak Terdaftar*\n\nNomor *${messageBody}* tidak ditemukan.`;
          await client.sendMessage(sender, `${userSession.data.numberResult}\n\n---\n\n💬 *Langkah 2: Analisis Pesan*\n\nSekarang kirim pesan yang ingin dianalisis:`);
        } else {
          await client.sendMessage(sender, `⚠️ *Format Nomor Salah*\n\nSilakan coba lagi atau ketik 'menu'.`);
        }
      } else {
        const phoneStatus = userSession.data.numberResult.includes("✅") ? "terverifikasi sebagai dosen ITS" : "tidak terdaftar";
        const promptCombined = `Analisis pesan: "${messageBody}". Konteks: nomor pengirim ${phoneStatus}. Tentukan apakah ini scam/spam. Jawab "Ya/Tidak, pesan ini adalah/bukan penipuan karena [alasan singkat dengan mempertimbangkan status nomor]." dalam satu paragraf biasa.`;
        const resultCombined = await model.generateContent(promptCombined);
        await client.sendMessage(sender, `📱💬 *Hasil Lengkap Verifikasi*\n\n**HASIL CEK NOMOR:**\n${userSession.data.numberResult}\n\n**HASIL ANALISIS PESAN:**\n🤖 ${(await resultCombined.response).text()}\n\n---\nKetik 'menu' untuk kembali.`);
        userSession.step = "menu";
        userSession.data = {};
      }
      break;
  }
  userSessions.set(sender, userSession);
});

// --- Penanganan Error Global dan Inisialisasi Bot ---
process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
  process.exit(1);
});

console.log("Memulai inisialisasi client WhatsApp...");
client.initialize().catch((err) => {
  console.error("FATAL: Gagal menginisialisasi client:", err);
  process.exit(1);
});
