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
