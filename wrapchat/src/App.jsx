import { useState, useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import html2canvas from "html2canvas";
import { supabase } from "./supabase";
import { processImportedChatFile } from "./import/fileProcessing";
import { MIN_MESSAGES } from "./import/whatsappParser";
import partnerIcon from "../../assets/partner.svg";
import datingIcon from "../../assets/dating.svg";
import exIcon from "../../assets/ex.svg";
import familyIcon from "../../assets/family.svg";
import friendIcon from "../../assets/friend.svg";
import colleagueIcon from "../../assets/colleage.svg";
import otherIcon from "../../assets/other.svg";

// Provided by App during the results phase; Shell reads it to show the close button.
// null means "no close button" (upload, auth, loading, etc.)
const CloseResultsContext = createContext(null);
const ShareResultsContext = createContext(null);
const FeedbackContext = createContext(null);

// Provided by Slide; Shell reads it to animate only its content area.
const SlideContext = createContext({ dir: "fwd", id: 0 });

// UI language preference — "english" stores as-is, "auto" follows detected chat lang.
// uiLang is the resolved code ("en","tr","es","pt","ar","fr","de","it").
const UILanguageContext = createContext({ uiLang: "en", uiLangPref: "english", updateUiLangPref: () => {} });
function useUILanguage() { return useContext(UILanguageContext); }
function useT() {
  const { uiLang } = useUILanguage();
  return (key, vars) => translateUI(uiLang, key, vars);
}

function isAdminUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

const FEEDBACK_OPTIONS = [
  "Events are mixing",
  "Wrong person",
  "Didn't happen",
  "Tone misread",
  "Overclaiming",
  "Missing context",
  "Other",
];

const ADMIN_EMAILS = Array.from(new Set(
  String(import.meta.env.VITE_ADMIN_EMAILS || import.meta.env.VITE_ADMIN_EMAIL || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
));

// ─────────────────────────────────────────────────────────────────
// LANGUAGE DETECTION  — heuristic only, no external dependency.
// Call detectLanguage(messages) → { code, label, confidence }.
// Upgrade this block freely without touching any other section.
// ─────────────────────────────────────────────────────────────────

// Human-readable labels for every supported language code.
const LANG_META = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  pt: "Portuguese",
  ar: "Arabic",
  fr: "French",
  de: "German",
  it: "Italian",
};

const UI_TRANSLATIONS = {
  en: {
    "quips.duo.obsessed": [
      `"{name}, you might want to check your screen time."`,
      `"{name} is carrying this conversation on pure texting stamina."`,
      `"Not obsessed, just extremely available. Sure, {name}."`,
    ],
    "quips.duo.responseBalanced": [
      `"Both of you are equally responsive. No ghosts here."`,
      `"Neither of you keeps the other waiting. Refreshing."`,
      `"Both responsive, both showing up. This is what balance looks like."`,
    ],
    "quips.duo.ghost": [
      `"{name} was 'busy'. Sure."`,
      `"{name}: read at 14:32. Replied at... eventually."`,
      `"{name} treats replies like a limited resource."`,
    ],
    "quips.duo.lastWord": [
      `"{name} sends a message. The chat decides not to continue."`,
      `"Last seen: {name}'s message, unanswered."`,
      `"{name} has a gift for sending the final word."`,
    ],
    "quips.duo.streak100": [
      `"{streak} days. That's not a streak, that's a lifestyle."`,
      `"Over {streak} consecutive days. Whatever this is, it's real."`,
      `"{streak} days straight. That's serious consistency."`,
    ],
    "quips.duo.streak30": [
      `"{streak} days without a gap. That kind of consistency is rare."`,
      `"A whole month-plus of showing up. That means something."`,
      `"No gaps. No excuses. Just {streak} days straight."`,
    ],
    "quips.duo.streak10": [
      `"{streak} days in a row. Not bad at all."`,
      `"Okay, that's actually kind of cute."`,
      `"A solid run. Something was clearly working during those {streak} days."`,
    ],
    "quips.duo.streakShort": [
      `"{streak} days. Short but real."`,
      `"Even a {streak}-day streak is something."`,
      `"{streak} days of not missing each other still counts."`,
    ],
    "quips.duo.convStarter": [
      `"Someone is always thinking of the other one first."`,
      `"{name} is always the one who breaks the silence first."`,
      `"The first text keeps coming from {name}. That says a lot."`,
    ],
    "quips.duo.messageLengthSimilar": [
      `"Almost identical message lengths. Suspiciously balanced."`,
      `"No novelist here, no texter either. Just two people typing about the same amount."`,
      `"Balanced. No essays, no one-word replies. Suspiciously normal."`,
    ],
    "quips.duo.messageLengthDifferent": [
      `"{novelist} treats every text like a letter to posterity."`,
      `"Somewhere {novelist} is still typing."`,
      `"{texter} replies. {novelist} responds. There's a difference."`,
    ],
    "quips.group.mainCharacter": [
      `"{name}, this is basically your personal blog."`,
      `"{name} came here to talk and is absolutely doing that."`,
      `"Without {name} this chat would be a graveyard."`,
    ],
    "quips.group.ghost": [
      `"{name} is here in spirit. Only in spirit."`,
      `"{name} joined the group and immediately disappeared into witness protection."`,
      `"A silent observer. A lurker. A mystery. {name}."`,
    ],
    "quips.group.lastWord": [
      `"{name} sends a message. The group doesn't respond. Classic."`,
      `"After {name}'s message, the group goes quiet every time."`,
      `"{name} has a habit of sending messages into the void."`,
    ],
    "quips.group.streak100": [
      `"{streak} days without a single gap. This group is built different."`,
      `"Over {streak} consecutive days. That's not a group chat, that's a commitment."`,
      `"Whatever keeps this group going, bottle it."`,
    ],
    "quips.group.streak30": [
      `"{streak} days of showing up. That's a real group."`,
      `"Not a single day off. This group has commitment in reverse."`,
      `"Most group chats go quiet after two weeks. This one didn't."`,
    ],
    "quips.group.streak10": [
      `"{streak} days in a row. The group was alive."`,
      `"You all actually like each other. Surprising."`,
      `"{streak} consecutive days. That's more than most groups manage."`,
    ],
    "quips.group.streakShort": [
      `"{streak} days. Small but it counts."`,
      `"A {streak}-day run still means something was happening."`,
      `"Even {streak} days in a row takes effort."`,
    ],
    "quips.group.novelist": [
      `"{name} types like the word limit doesn't exist."`,
      `"{name} sends messages with full plot development."`,
      `"If there is an essay in the group, {name} wrote it."`,
    ],
  },
  tr: {
    "Choose your language": "Dilini seç",
    "English": "İngilizce",
    "Auto-detect": "Otomatik algıla",
    "Continue": "Devam et",
    "Back": "Geri",
    "Next": "İleri",
    "See summary": "Özeti gör",
    "Done": "Bitti",
    "Start over": "Baştan başla",
    "Share": "Paylaş",
    "What's off about this?": "Burada yanlış olan ne?",
    "Optional note": "İsteğe bağlı not",
    "Cancel": "İptal",
    "Submit": "Gönder",
    "Sending…": "Gönderiliyor…",
    "Got it, thank you.": "Tamamdır, teşekkürler.",
    "Events are mixing": "Olaylar karışmış",
    "Wrong person": "Yanlış kişi",
    "Didn't happen": "Hiç yaşanmadı",
    "Tone misread": "Ton yanlış okunmuş",
    "Overclaiming": "Fazla iddialı",
    "Missing context": "Bağlam eksik",
    "Other": "Diğer",
    "The Roast": "Kavrulma",
    "The Lovely": "Tatlı Taraf",
    "The Funny": "Komik Taraf",
    "The Stats": "İstatistikler",
    "Insight": "İçgörü",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Toksisite Raporu",
    "Love Language": "Sevgi Dili",
    "Growth Report": "Gelişim Raporu",
    "Accountability": "Sorumluluk",
    "Energy Report": "Enerji Raporu",
    "Choose your report": "Raporunu seç",
    "Who is this chat with?": "Bu sohbet kiminle?",
    "This helps the AI frame the analysis correctly.": "Bu, yapay zekanın analizi doğru çerçevelemesine yardımcı olur.",
    "Partner": "Partner",
    "Dating": "Flört",
    "Ex": "Eski sevgili",
    "Related": "Akraba",
    "Friend": "Arkadaş",
    "Colleague": "İş arkadaşı",
    "Romantic partner or spouse": "Romantik partner ya da eş",
    "Seeing each other or early stages": "Görüşüyorsunuz ya da ilişkinin başları",
    "Former romantic partner": "Eski romantik partner",
    "Parent, sibling or relative": "Ebeveyn, kardeş ya da akraba",
    "Close friend or bestie": "Yakın arkadaş ya da kanka",
    "Coworker or professional contact": "İş arkadaşı ya da profesyonel tanıdık",
    "Someone you know": "Tanıdığın biri",
    "Reading your messages...": "Mesajların okunuyor...",
    "Finding the patterns...": "Örüntüler bulunuyor...",
    "Figuring out who's funny...": "Kimin komik olduğu çözülüyor...",
    "Detecting the drama...": "Dramalar tespit ediliyor...",
    "Reading between the lines...": "Satır araları okunuyor...",
    "Almost done...": "Neredeyse bitti...",
    "Upload different file": "Farklı bir dosya yükle",
    "Upload your chat": "Sohbetini yükle",
    "Reading your chat…": "Sohbetin okunuyor…",
    "My Results": "Sonuçlarım",
    "Edit": "Düzenle",
    "Your chats, unwrapped.": "Sohbetlerinin şifresi çözülüyor.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Grup ya da ikili sohbet otomatik algılanır. Sohbetin yapay zekâ ile analiz edilir ve asla saklanmaz. Yalnızca sonuçlar kaydedilir.",
    "UI language": "Arayüz dili",
    "Report language": "Rapor dili",
    "auto": "otomatik",
    "changed": "değişti",
    "Who's more obsessed?": "Kim daha takıntılı?",
    "The Ghost Award": "Hayalet Ödülü",
    "Response times": "Yanıt süreleri",
    "Balanced": "Dengeli",
    "The Last Word": "Son Sözü Söyleyen",
    "Your longest streak": "En uzun seriniz",
    "The Kindest One": "En Nazik Olan",
    "The Hype Person": "Gaz Veren Kişi",
    "The Funny One": "En Komik Olan",
    "Spirit emojis": "Ruh emojileri",
    "Group spirit emoji": "Grubun ruh emojisi",
    "Top 10 most used words": "En çok kullanılan 10 kelime",
    "Signature phrases": "İmza cümleler",
    "Message length": "Mesaj uzunluğu",
    "The Novelist vs The Texter": "Roman yazarı ve kısa mesajcı",
    "The Novelist": "Roman yazarı",
    "Media and links": "Medya ve linkler",
    "What you actually talk about": "Aslında ne konuşuyorsunuz",
    "The Drama Report": "Drama Raporu",
    "What's really going on": "Aslında neler oluyor",
    "Chat vibe": "Sohbet havası",
    "Relationship reading": "İlişki yorumu",
    "Evidence log": "Kanıt dökümü",
    "What the chat shows": "Sohbetin gösterdiği şey",
    "Toxicity scorecard": "Toksisite puan kartı",
    "Tension snapshot": "Gerilim özeti",
    "What keeps repeating": "Sürekli tekrar eden şey",
    "Toxicity report": "Toksisite raporu",
    "The Main Character": "Ana karakter",
    "The Ghost": "Hayalet",
    "Longest active streak": "En uzun aktif seri",
    "Group roles": "Grup rolleri",
    "Most missed member": "En çok özlenen üye",
    "The group read": "Grup yorumu",
    "Group vibe": "Grup havası",
    "Group pattern read": "Grup örüntü yorumu",
    "Support and strain": "Destek ve yük",
    "Chat Health Score": "Sohbet Sağlık Puanı",
    "Individual health scores": "Bireysel sağlık puanları",
    "Who apologises more": "Kim daha çok özür diliyor",
    "Red flag moments": "Kırmızı bayrak anları",
    "Conflict pattern": "Çatışma örüntüsü",
    "Power balance": "Güç dengesi",
    "The verdict": "Son karar",
    "Love language compatibility": "Sevgi dili uyumu",
    "The language gap": "Dil farkı",
    "Most loving moment": "En sevgi dolu an",
    "Then vs Now": "O zaman ve şimdi",
    "Who changed more": "Kim daha çok değişti",
    "What changed in the chat": "Sohbette ne değişti",
    "Relationship trajectory": "İlişkinin gidişatı",
    "The arc": "Hikâye akışı",
    "Promises made": "Verilen sözler",
    "Most notable broken promise": "En dikkat çeken tutulmayan söz",
    "Most notable kept promise": "En dikkat çeken tutulan söz",
    "The overall verdict": "Genel karar",
    "Net energy scores": "Net enerji puanları",
    "Energy compatibility": "Enerji uyumu",
    "Most energising moment": "En enerji veren an",
    "Most draining moment": "En yoran an",
    "How they do it": "Bunu nasıl yapıyor",
    "Drops lines like": "Şöyle cümleler kuruyor",
    "The sweetest moment": "En tatlı an",
    "Why this person scores highest": "Bu kişi neden en yüksek puanı aldı",
    "How arguments unfold": "Tartışmalar nasıl ilerliyor",
    "Power dynamic": "Güç dinamiği",
    "Final read": "Son yorum",
    "Score breakdown": "Puan dökümü",
    "Do they speak the same language?": "Aynı dili konuşuyorlar mı?",
    "The moment": "O an",
    "Compatibility read": "Uyum yorumu",
    "How they changed": "Nasıl değiştiler",
    "Topics that appeared": "Ortaya çıkan konular",
    "Topics that faded": "Azalan konular",
    "What the data shows": "Verinin gösterdiği",
    "Overall verdict": "Genel karar",
    "Pattern": "Örüntü",
    "Positive energy": "Pozitif enerji",
    "Draining patterns": "Yoran örüntüler",
    "Most active 3 months": "En aktif 3 ay",
    "avg chars": "ort. karakter",
    "longest message": "en uzun mesaj",
    "msgs": "mesaj",
    "Photos & videos": "Fotoğraflar ve videolar",
    "Voice memos": "Sesli notlar",
    "Links shared": "Paylaşılan linkler",
    "Your relationship, in data.": "İlişkin verilerle önünde.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "WhatsApp sohbetini okur ve aslında neler olduğunu gösterir. Kim varlık gösteriyor. Kim kayboluyor. Sohbeti kim taşıyor.",
    "Start with your chat.": "Sohbetinle başla.",
    "Upload. Analyse. See it clearly.": "Yükle. Analiz et. Net gör.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Altı rapor. Toksisite, sevgi dilleri, sorumluluk, enerji, gelişim ve tam sohbet özetin. Sonuçlar bir dakikadan kısa sürede.",
    "Open WhatsApp": "WhatsApp'ı aç",
    "Tap the chat you want to analyse": "Analiz etmek istediğin sohbete dokun",
    "Tap ··· menu → More → Export Chat": "··· menüsüne dokun → Daha fazla → Sohbeti dışa aktar",
    "Choose Without Media": "Medya olmadan seç",
    "Save the .txt file to your device": ".txt dosyasını cihazına kaydet",
    "Toxicity": "Toksisite",
    "Love Languages": "Sevgi Dilleri",
    "Energy": "Enerji",
    "Growth": "Gelişim",
    "Chat Wrapped": "Sohbet Özeti",
    "General Wrapped": "Genel Özet",
    "The full Wrapped-style deep dive — stats, AI insights, and your chat personality.": "Wrapped tarzı tam derin inceleme: istatistikler, yapay zekâ içgörüleri ve sohbet kişiliğin.",
    "Red flags, power imbalances, who apologises more, conflict patterns, health scores.": "Kırmızı bayraklar, güç dengesizlikleri, kimin daha çok özür dilediği, çatışma örüntüleri ve sağlık puanları.",
    "Love Language Report": "Sevgi Dili Raporu",
    "How each person shows affection, mapped to the 5 love languages. Works for friends too.": "Her kişinin sevgisini nasıl gösterdiğini 5 sevgi diline göre haritalar. Arkadaşlıklar için de çalışır.",
    "First 3 months vs last 3 months — are you growing together or drifting apart?": "İlk 3 ay ve son 3 ay karşılaştırması: beraber mi büyüyorsunuz, yoksa uzaklaşıyor musunuz?",
    "Accountability Report": "Sorumluluk Raporu",
    "Promises made in the chat and whether they were followed through. Receipts for both.": "Sohbette verilen sözler ve tutulup tutulmadıkları. Her iki taraf için de kanıtlar.",
    "Who brings good energy vs drains it — net energy score per person.": "Kim iyi enerji getiriyor, kim tüketiyor: kişi başına net enerji puanı.",
    "quips.duo.obsessed": [
      `"{name}, ekran sürene bir bakman gerekebilir."`,
      `"{name} bu sohbeti saf mesajlaşma dayanıklılığıyla taşıyor."`,
      `"Takıntı değil, sadece aşırı müsait. Tabii {name}."`,
    ],
    "quips.duo.responseBalanced": [
      `"İkiniz de aynı derecede hızlı dönüyorsunuz. Burada hayalet yok."`,
      `"Kimse diğerini bekletmiyor. Ferahlatıcı."`,
      `"İkiniz de cevap veriyor, ikiniz de varlık gösteriyor. Denge böyle bir şey."`,
    ],
    "quips.duo.ghost": [
      `"{name} 'meşguldüm' dedi. Tabii."`,
      `"{name}: mesajı okudu, sonra... bir ara cevap verdi."`,
      `"{name} cevapları sınırlı kaynak gibi kullanıyor."`,
    ],
    "quips.duo.lastWord": [
      `"{name} mesaj atıyor. Sohbet devam etmemeye karar veriyor."`,
      `"Son görülen: {name}'in cevapsız mesajı."`,
      `"{name} son sözü söyleme konusunda özel yetenekli."`,
    ],
    "quips.duo.streak100": [
      `"{streak} gün. Buna seri değil, yaşam tarzı denir."`,
      `"{streak} gün üst üste. Bu her neyse gerçek."`,
      `"{streak} gün boyunca kesintisiz. Ciddi bir tutarlılık."`,
    ],
    "quips.duo.streak30": [
      `"{streak} gün aralıksız. Böyle bir istikrar nadir."`,
      `"Bir aydan fazla süre boyunca sürekli var olmak bir şey anlatır."`,
      `"Bahane yok, boşluk yok. Sadece {streak} gün üst üste."`,
    ],
    "quips.duo.streak10": [
      `"{streak} gün üst üste. Hiç fena değil."`,
      `"Tamam, bu aslında biraz tatlı."`,
      `"O {streak} gün boyunca bir şeyler net şekilde iyi gidiyordu."`,
    ],
    "quips.duo.streakShort": [
      `"{streak} gün. Kısa ama gerçek."`,
      `"Bir {streak} günlük seri bile bir şeydir."`,
      `"{streak} gün boyunca birbirini kaçırmamak yine sayılır."`,
    ],
    "quips.duo.convStarter": [
      `"Birisi hep önce diğerini düşünüyor."`,
      `"{name} sessizliği ilk bozan kişi olmaya devam ediyor."`,
      `"İlk mesajın sürekli {name}'den gelmesi çok şey söylüyor."`,
    ],
    "quips.duo.messageLengthSimilar": [
      `"Mesaj uzunlukları neredeyse aynı. Şüpheli derecede dengeli."`,
      `"Burada ne romancı var ne de tek kelimelik mesajcı. Sadece benzer uzunlukta yazan iki kişi."`,
      `"Dengeli. Ne destan ne tek kelimelik cevap. Şüpheli derecede normal."`,
    ],
    "quips.duo.messageLengthDifferent": [
      `"{novelist} her mesajı gelecek nesillere mektup gibi görüyor."`,
      `"Bir yerlerde {novelist} hâlâ yazıyor."`,
      `"{texter} cevap veriyor. {novelist} ise yanıt değil, paragraf gönderiyor."`,
    ],
    "quips.group.mainCharacter": [
      `"{name}, bu resmen senin kişisel blogun."`,
      `"{name} konuşmaya gelmiş ve gerçekten konuşuyor."`,
      `"{name} olmasa bu sohbet mezarlık olurdu."`,
    ],
    "quips.group.ghost": [
      `"{name} sadece ruhen burada."`,
      `"{name} gruba katıldı ve anında kayıplara karıştı."`,
      `"Sessiz gözlemci. Gizemli izleyici. {name}."`,
    ],
    "quips.group.lastWord": [
      `"{name} mesaj atıyor. Grup cevap vermiyor. Klasik."`,
      `"{name}'in mesajından sonra grup her seferinde sessizleşiyor."`,
      `"{name} mesajları boşluğa göndermeyi alışkanlık hâline getirmiş."`,
    ],
    "quips.group.streak100": [
      `"{streak} gün tek bir boşluk bile olmadan. Bu grup farklı."`,
      `"{streak} gün üst üste. Bu grup sohbetten çok taahhüt."`,
      `"Bu grubu ayakta tutan şeyi şişeleyip satmak lazım."`,
    ],
    "quips.group.streak30": [
      `"{streak} gün boyunca ortadasınız. Bu gerçek bir grup."`,
      `"Tek bir gün bile boş yok. Bu grubun tersinden bağlılık sorunu var."`,
      `"Çoğu grup iki haftada susar. Bu grup susmadı."`,
    ],
    "quips.group.streak10": [
      `"{streak} gün üst üste. Grup yaşıyormuş."`,
      `"Demek ki hepiniz birbirinizi gerçekten seviyorsunuz. Şaşırtıcı."`,
      `"{streak} gün üst üste. Çoğu grubun becerdiğinden fazla."`,
    ],
    "quips.group.streakShort": [
      `"{streak} gün. Küçük ama sayılır."`,
      `"Bir {streak} günlük seri bile grupta bir şeyler olduğunu gösterir."`,
      `"Arka arkaya {streak} gün bile emek ister."`,
    ],
    "quips.group.novelist": [
      `"{name} sanki kelime sınırı yokmuş gibi yazıyor."`,
      `"{name} mesaj değil, tam hikâye gönderiyor."`,
      `"Grupta bir deneme yazısı varsa onu {name} yazmıştır."`,
    ],
    // ── Missing strings added ──
    "Red flag {index}": "Kırmızı bayrak {index}",
    "This pattern showed up enough to feel worth watching.": "Bu örüntü dikkat çekecek kadar sık karşımıza çıktı.",
    "Evidence": "Kanıt",
    "{pct}% of all messages came from {name}.": "Tüm mesajların %{pct}'i {name}'den geldi.",
    "{name} avg reply:": "{name} ort. yanıt:",
    "Sends the last message that nobody replies to — {count} times.": "Yanıtsız kalan son mesajı gönderen kişi — {count} kez.",
    "Sends the last message that nobody replies to.": "Yanıtsız kalan son mesajı gönderen kişi.",
    "{count} days": "{count} gün",
    "Texted every single day for {count} days straight.": "{count} gün boyunca her gün mesajlaştınız.",
    "Top 3 most active months": "En aktif 3 ay",
    "{month} was your month. Something was going on.": "{month} sizin ayınızdı. Bir şeyler oluyordu.",
    "Who always reaches out first?": "Her zaman ilk kim yazıyor?",
    "Started {pct} of all conversations.": "Tüm konuşmaların %{pct}'ini başlattı.",
    "These two emojis basically ARE this chat.": "Bu iki emoji bu sohbeti tam olarak özetliyor.",
    "The phrases that define each of you.": "Her birinizi tanımlayan cümleler.",
    "Biggest topic": "En büyük konu",
    "Most tense moment": "En gergin an",
    "A chaotic, wholesome connection.": "Kaotik ama sağlıklı bir bağ.",
    "Powered by AI — your messages never left your device.": "Yapay zekâ destekli — mesajların hiçbir zaman cihazını terk etmedi.",
    "Observed pattern": "Gözlemlenen örüntü",
    "Concrete example": "Somut örnek",
    "Main topic": "Ana konu",
    "Pattern note": "Örüntü notu",
    "The strongest pattern is shown above.": "En belirgin örüntü yukarıda gösterilmektedir.",
    "Overall read": "Genel yorum",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Bu mod sana karar vermek için değil, örüntüleri ve örnekleri göstermek için tasarlandı.",
    "{count} messages total. Why are they even here?": "Toplam {count} mesaj. Neden buradalar ki?",
    "The group was most alive in {month}.": "Grup en çok {month} ayında aktifti.",
    "The group kept the chat alive for {count} days straight.": "Grup, sohbeti {count} gün boyunca kesintisiz canlı tuttu.",
    "Started {pct} of all conversations. The engine of this group.": "Tüm konuşmaların %{pct}'ini başlattı. Bu grubun motoru.",
    "Why {name} is the hype": "{name} neden gaz veriyor",
    "This one emoji basically summarises the entire group energy.": "Bu tek emoji grubun tüm enerjisini özetliyor.",
    "Their longest message was mostly about \"{topic}\".": "En uzun mesajı büyük ölçüde \"{topic}\" hakkındaydı.",
    "The inside joke": "Grup içi şaka",
    "When they go quiet, the group feels it.": "Sessiz kaldığında, grup bunu hissediyor.",
    "Group dynamic": "Grup dinamiği",
    "Chaotic. Wholesome. Somehow still going.": "Kaotik. Sağlıklı. Bir şekilde hâlâ devam ediyor.",
    "Who keeps it going": "Kim devam ettiriyor",
    "{name} started {pct} of conversations.": "{name} konuşmaların %{pct}'ini başlattı.",
    "The group shares the conversation starts.": "Grup konuşma başlatmayı paylaşıyor.",
    "Who goes quiet": "Kim sessizleşiyor",
    "{name} is the least active member in the sampled history.": "{name}, örneklenen geçmişte en az aktif üye.",
    "No clear ghost in this sample.": "Bu örnekte belirgin bir hayalet yok.",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "10 üzerinden — çatışma örüntüleri, iletişim tarzı ve genel dinamiğe göre.",
    "Verdict": "Karar",
    "Overall chat health score.": "Genel sohbet sağlık puanı.",
    "Reflects patterns in this sample — not a final judgment.": "Bu örnekteki örüntüleri yansıtır — kesin bir yargı değildir.",
    "{name}'s love language": "{name}'in sevgi dili",
    "How they show it": "Bunu nasıl gösteriyor",
    "Early messages": "Erken mesajlar",
    "Recent messages": "Son mesajlar",
    "promises": "söz",
    "{name}'s accountability": "{name}'in sorumluluğu",
    "kept": "tutuldu",
    "broken": "bozuldu",
    "{name}'s energy": "{name}'in enerjisi",
    "messages": "mesaj",
    "Skip": "Geç",
    "Log out": "Çıkış yap",
    "Feedback Inbox": "Geri Bildirim Kutusu",
    "Large group detected — analysing the top {cap} members out of {count}.": "Büyük grup algılandı — {count} üyeden en aktif {cap} tanesi analiz ediliyor.",
  },
  es: {
    "Choose your language": "Elige tu idioma",
    "English": "Inglés",
    "Auto-detect": "Detección automática",
    "Continue": "Continuar",
    "Back": "Atrás",
    "Next": "Siguiente",
    "See summary": "Ver resumen",
    "Done": "Listo",
    "Start over": "Empezar de nuevo",
    "Share": "Compartir",
    "What's off about this?": "¿Qué está mal aquí?",
    "Optional note": "Nota opcional",
    "Cancel": "Cancelar",
    "Submit": "Enviar",
    "Sending…": "Enviando…",
    "Got it, thank you.": "Entendido, gracias.",
    "Events are mixing": "Se mezclan los eventos",
    "Wrong person": "Persona equivocada",
    "Didn't happen": "No ocurrió",
    "Tone misread": "Tono mal interpretado",
    "Overclaiming": "Afirma demasiado",
    "Missing context": "Falta contexto",
    "Other": "Otro",
    "The Roast": "La Quemada",
    "The Lovely": "Lo Tierno",
    "The Funny": "Lo Divertido",
    "The Stats": "Las Estadísticas",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Informe de Toxicidad",
    "Love Language": "Lenguaje del Amor",
    "Growth Report": "Informe de Evolución",
    "Accountability": "Responsabilidad",
    "Energy Report": "Informe de Energía",
    "Choose your report": "Elige tu informe",
    "Who is this chat with?": "¿Con quién es este chat?",
    "This helps the AI frame the analysis correctly.": "Esto ayuda a la IA a enfocar bien el análisis.",
    "Partner": "Pareja",
    "Dating": "Saliendo",
    "Ex": "Ex",
    "Related": "Familia",
    "Friend": "Amigo",
    "Colleague": "Colega",
    "Romantic partner or spouse": "Pareja romántica o cónyuge",
    "Seeing each other or early stages": "Conociéndose o en etapas iniciales",
    "Former romantic partner": "Expareja romántica",
    "Parent, sibling or relative": "Padre, hermano o familiar",
    "Close friend or bestie": "Amigo cercano o mejor amigo",
    "Coworker or professional contact": "Compañero de trabajo o contacto profesional",
    "Someone you know": "Alguien que conoces",
    "Reading your messages...": "Leyendo tus mensajes...",
    "Finding the patterns...": "Buscando los patrones...",
    "Figuring out who's funny...": "Viendo quién es el gracioso...",
    "Detecting the drama...": "Detectando el drama...",
    "Reading between the lines...": "Leyendo entre líneas...",
    "Almost done...": "Casi listo...",
    "Upload different file": "Subir otro archivo",
    "Upload your chat": "Sube tu chat",
    "Reading your chat…": "Leyendo tu chat…",
    "My Results": "Mis resultados",
    "Edit": "Editar",
    "Your chats, unwrapped.": "Tus chats, al descubierto.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Se detecta automáticamente si es grupo o dúo. Tu chat se analiza con IA y nunca se guarda. Solo se guardan los resultados.",
    "UI language": "Idioma de la interfaz",
    "Report language": "Idioma del informe",
    "auto": "auto",
    "changed": "cambiado",
    "quips.duo.obsessed": [`"{name}, quizá deberías revisar tu tiempo de pantalla."`,`"{name} está sosteniendo esta conversación con pura resistencia al texto."`,`"No es obsesión, solo demasiada disponibilidad. Claro, {name}."`],
    "quips.duo.responseBalanced": [`"Ambos responden igual de rápido. No hay fantasmas aquí."`,`"Nadie deja esperando a la otra persona. Se agradece."`,`"Los dos aparecen y responden. Así se ve el equilibrio."`],
    "quips.duo.ghost": [`"Claro, {name} estaba 'ocupado'."`,`"{name}: leyó el mensaje y respondió... eventualmente."`,`"{name} trata las respuestas como un recurso limitado."`],
    "quips.duo.lastWord": [`"{name} manda un mensaje y la conversación termina ahí."`,`"Última escena: el mensaje de {name}, sin respuesta."`,`"{name} tiene talento para poner la última palabra."`],
    "quips.duo.streak100": [`"{streak} días. Eso no es una racha, es un estilo de vida."`,`"Más de {streak} días seguidos. Lo que sea esto, es real."`,`"{streak} días seguidos. Eso es consistencia seria."`],
    "quips.duo.streak30": [`"{streak} días sin huecos. Eso es raro."`,`"Más de un mes apareciendo. Eso significa algo."`,`"Sin pausas, sin excusas. Solo {streak} días seguidos."`],
    "quips.duo.streak10": [`"{streak} días seguidos. Nada mal."`,`"Vale, eso sí es un poco tierno."`,`"Algo estaba funcionando en esos {streak} días."`],
    "quips.duo.streakShort": [`"{streak} días. Corto, pero real."`,`"Incluso una racha de {streak} días cuenta."`,`"{streak} días sin dejar de hablar también suma."`],
    "quips.duo.convStarter": [`"Alguien piensa primero en la otra persona cada vez."`,`"{name} siempre rompe el silencio primero."`,`"El primer mensaje sigue viniendo de {name}. Eso dice mucho."`],
    "quips.duo.messageLengthSimilar": [`"Mensajes casi idénticos. Sospechosamente equilibrado."`,`"Aquí no hay novelista ni minimalista. Solo dos personas escribiendo parecido."`,`"Equilibrado. Sin ensayos, sin respuestas de una palabra."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} trata cada mensaje como una carta para la posteridad."`,`"En algún lugar, {novelist} sigue escribiendo."`,`"{texter} responde. {novelist} redacta."`],
    "quips.group.mainCharacter": [`"{name}, esto es básicamente tu blog personal."`,`"{name} vino a hablar y claramente lo está haciendo."`,`"Sin {name}, este chat sería un cementerio."`],
    "quips.group.ghost": [`"{name} está aquí solo en espíritu."`,`"{name} entró al grupo y desapareció al instante."`,`"Observador silencioso. Misterio total. {name}."`],
    "quips.group.lastWord": [`"{name} manda un mensaje. El grupo no responde. Clásico."`,`"Después del mensaje de {name}, el grupo se calla cada vez."`,`"{name} tiene la costumbre de lanzar mensajes al vacío."`],
    "quips.group.streak100": [`"{streak} días sin un solo hueco. Este grupo es distinto."`,`"Más de {streak} días seguidos. Esto ya es compromiso."`,`"Lo que mantiene vivo a este grupo debería venderse."`],
    "quips.group.streak30": [`"{streak} días apareciendo. Eso es un grupo de verdad."`,`"Ni un día libre. Este grupo va en serio."`,`"La mayoría de los grupos mueren en dos semanas. Este no."`],
    "quips.group.streak10": [`"{streak} días seguidos. El grupo estaba vivo."`,`"Parece que sí se caen bien. Sorpresa."`,`"{streak} días seguidos. Más que la mayoría de los grupos."`],
    "quips.group.streakShort": [`"{streak} días. Poco, pero cuenta."`,`"Una racha de {streak} días igual significa algo."`,`"Incluso {streak} días seguidos requieren ganas."`],
    "quips.group.novelist": [`"{name} escribe como si no existiera límite de palabras."`,`"{name} manda mensajes con desarrollo completo de trama."`,`"Si hay un ensayo en el grupo, lo escribió {name}."`],
    "msgs": "msgs",
    "Red flag {index}": "Señal de alerta {index}",
    "This pattern showed up enough to feel worth watching.": "Este patrón apareció lo suficiente como para prestarle atención.",
    "Evidence": "Evidencia",
    "Who's more obsessed?": "¿Quién está más obsesionado?",
    "{pct}% of all messages came from {name}.": "El {pct}% de todos los mensajes vino de {name}.",
    "Response times": "Tiempos de respuesta",
    "Balanced": "Equilibrado",
    "{name} avg reply:": "{name} respuesta prom.:",
    "The Ghost Award": "El Premio Fantasma",
    "What's really going on": "Lo que realmente está pasando",
    "The Last Word": "La Última Palabra",
    "Sends the last message that nobody replies to — {count} times.": "Envía el último mensaje que nadie responde — {count} veces.",
    "Sends the last message that nobody replies to.": "Envía el último mensaje que nadie responde.",
    "Your longest streak": "Tu racha más larga",
    "{count} days": "{count} días",
    "Texted every single day for {count} days straight.": "Mensajes cada día durante {count} días seguidos.",
    "The Kindest One": "La Persona Más Amable",
    "The sweetest moment": "El momento más tierno",
    "Top 3 most active months": "Los 3 meses más activos",
    "{month} was your month. Something was going on.": "{month} fue vuestro mes. Algo estaba pasando.",
    "Who always reaches out first?": "¿Quién siempre escribe primero?",
    "Started {pct} of all conversations.": "Inició el {pct}% de todas las conversaciones.",
    "The Funny One": "El Más Gracioso",
    "Drops lines like": "Suelta frases como",
    "Spirit emojis": "Emojis espíritu",
    "These two emojis basically ARE this chat.": "Estos dos emojis básicamente SON este chat.",
    "Top 10 most used words": "Las 10 palabras más usadas",
    "Signature phrases": "Frases características",
    "The phrases that define each of you.": "Las frases que definen a cada uno.",
    "avg chars": "caract. prom.",
    "longest message": "mensaje más largo",
    "Media and links": "Medios y enlaces",
    "Photos & videos": "Fotos y vídeos",
    "Voice memos": "Notas de voz",
    "Links shared": "Enlaces compartidos",
    "What you actually talk about": "De qué habláis realmente",
    "Biggest topic": "Tema principal",
    "Most tense moment": "El momento más tenso",
    "The Drama Report": "El Informe de Drama",
    "How they do it": "Cómo lo hace",
    "Chat vibe": "Ambiente del chat",
    "A chaotic, wholesome connection.": "Una conexión caótica y sana.",
    "Powered by AI — your messages never left your device.": "Impulsado por IA — tus mensajes nunca salieron de tu dispositivo.",
    "Relationship reading": "Lectura de la relación",
    "Observed pattern": "Patrón observado",
    "Concrete example": "Ejemplo concreto",
    "Evidence log": "Registro de evidencias",
    "What the chat shows": "Lo que muestra el chat",
    "Toxicity scorecard": "Tarjeta de toxicidad",
    "Why this person scores highest": "Por qué esta persona puntúa más alto",
    "Tension snapshot": "Instantánea de tensión",
    "What keeps repeating": "Lo que sigue repitiéndose",
    "Main topic": "Tema principal",
    "Pattern note": "Nota sobre el patrón",
    "The strongest pattern is shown above.": "El patrón más fuerte se muestra arriba.",
    "Toxicity report": "Informe de toxicidad",
    "Overall read": "Lectura general",
    "Score breakdown": "Desglose de puntuación",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Este modo sirve para mostrar patrones y ejemplos, no para decidir por ti.",
    "The Main Character": "El Personaje Principal",
    "The Ghost": "El Fantasma",
    "{count} messages total. Why are they even here?": "{count} mensajes en total. ¿Por qué están aquí?",
    "The group was most alive in {month}.": "El grupo estuvo más activo en {month}.",
    "Longest active streak": "Racha activa más larga",
    "The group kept the chat alive for {count} days straight.": "El grupo mantuvo el chat vivo durante {count} días seguidos.",
    "The Hype Person": "El Animador del Grupo",
    "Started {pct} of all conversations. The engine of this group.": "Inició el {pct}% de todas las conversaciones. El motor del grupo.",
    "Why {name} is the hype": "Por qué {name} anima el grupo",
    "Group spirit emoji": "Emoji espíritu del grupo",
    "This one emoji basically summarises the entire group energy.": "Este emoji resume básicamente toda la energía del grupo.",
    "The Novelist": "El Novelista",
    "Their longest message was mostly about \"{topic}\".": "Su mensaje más largo trató principalmente sobre \"{topic}\".",
    "The inside joke": "El chiste interno",
    "Most missed member": "El miembro más echado de menos",
    "When they go quiet, the group feels it.": "Cuando se calla, el grupo lo nota.",
    "The group read": "La lectura del grupo",
    "Group dynamic": "Dinámica del grupo",
    "Group vibe": "Ambiente del grupo",
    "Chaotic. Wholesome. Somehow still going.": "Caótico. Sano. De alguna forma sigue adelante.",
    "Group pattern read": "Lectura del patrón del grupo",
    "Support and strain": "Apoyo y tensión",
    "Who keeps it going": "Quién lo mantiene vivo",
    "{name} started {pct} of conversations.": "{name} inició el {pct}% de las conversaciones.",
    "The group shares the conversation starts.": "El grupo comparte el inicio de las conversaciones.",
    "Who goes quiet": "Quién se calla",
    "{name} is the least active member in the sampled history.": "{name} es el miembro menos activo en el historial analizado.",
    "No clear ghost in this sample.": "No hay un fantasma claro en esta muestra.",
    "Chat Health Score": "Puntuación de Salud del Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Sobre 10 — basado en patrones de conflicto, estilo de comunicación y dinámica general.",
    "Verdict": "Veredicto",
    "Individual health scores": "Puntuaciones individuales de salud",
    "Who apologises more": "Quién se disculpa más",
    "Red flag moments": "Momentos de alerta",
    "Conflict pattern": "Patrón de conflicto",
    "How arguments unfold": "Cómo se desarrollan las discusiones",
    "Power balance": "Equilibrio de poder",
    "Power dynamic": "Dinámica de poder",
    "The verdict": "El veredicto",
    "Overall chat health score.": "Puntuación general de salud del chat.",
    "Final read": "Lectura final",
    "Reflects patterns in this sample — not a final judgment.": "Refleja patrones en esta muestra — no es un juicio definitivo.",
    "{name}'s love language": "El lenguaje del amor de {name}",
    "How they show it": "Cómo lo muestra",
    "The language gap": "La brecha del lenguaje",
    "Do they speak the same language?": "¿Hablan el mismo idioma?",
    "Most loving moment": "El momento más amoroso",
    "The moment": "El momento",
    "Love language compatibility": "Compatibilidad del lenguaje del amor",
    "Compatibility read": "Lectura de compatibilidad",
    "Then vs Now": "Antes vs Ahora",
    "Early messages": "Mensajes tempranos",
    "Recent messages": "Mensajes recientes",
    "Who changed more": "Quién cambió más",
    "How they changed": "Cómo cambiaron",
    "What changed in the chat": "Qué cambió en el chat",
    "Topics that appeared": "Temas que aparecieron",
    "Topics that faded": "Temas que desaparecieron",
    "Relationship trajectory": "Trayectoria de la relación",
    "What the data shows": "Lo que muestran los datos",
    "The arc": "El arco",
    "Promises made": "Promesas hechas",
    "promises": "promesas",
    "Overall verdict": "Veredicto general",
    "{name}'s accountability": "Responsabilidad de {name}",
    "kept": "cumplidas",
    "broken": "incumplidas",
    "Pattern": "Patrón",
    "Most notable broken promise": "La promesa incumplida más notable",
    "Most notable kept promise": "La promesa cumplida más notable",
    "Net energy scores": "Puntuaciones netas de energía",
    "Energy compatibility": "Compatibilidad de energía",
    "{name}'s energy": "La energía de {name}",
    "Positive energy": "Energía positiva",
    "Draining patterns": "Patrones agotadores",
    "Most energising moment": "El momento más energizante",
    "Most draining moment": "El momento más agotador",
    "messages": "mensajes",
    "Your relationship, in data.": "Tu relación, en datos.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Lee tu chat de WhatsApp y te muestra lo que realmente pasa. Quién aparece. Quién desaparece. Quién lleva la conversación.",
    "Skip": "Omitir",
    "Start with your chat.": "Empieza con tu chat.",
    "Upload. Analyse. See it clearly.": "Sube. Analiza. Vélo claramente.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Seis informes. Toxicidad, lenguajes del amor, responsabilidad, energía, crecimiento y tu chat completo resumido. Resultados en menos de un minuto.",
    "Log out": "Cerrar sesión",
    "Feedback Inbox": "Bandeja de comentarios",
    "Large group detected — analysing the top {cap} members out of {count}.": "Grupo grande detectado — analizando los {cap} miembros más activos de {count}.",
  },
  pt: {
    "Choose your language": "Escolha seu idioma",
    "English": "Inglês",
    "Auto-detect": "Detecção automática",
    "Continue": "Continuar",
    "Back": "Voltar",
    "Next": "Próximo",
    "See summary": "Ver resumo",
    "Done": "Concluir",
    "Start over": "Começar de novo",
    "Share": "Compartilhar",
    "What's off about this?": "O que está errado aqui?",
    "Optional note": "Observação opcional",
    "Cancel": "Cancelar",
    "Submit": "Enviar",
    "Sending…": "Enviando…",
    "Got it, thank you.": "Entendi, obrigada.",
    "Events are mixing": "Os eventos se misturaram",
    "Wrong person": "Pessoa errada",
    "Didn't happen": "Não aconteceu",
    "Tone misread": "Tom mal interpretado",
    "Overclaiming": "Exagero na conclusão",
    "Missing context": "Falta contexto",
    "Other": "Outro",
    "The Roast": "A Zoeira",
    "The Lovely": "O Fofo",
    "The Funny": "O Engraçado",
    "The Stats": "As Estatísticas",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Relatório de Toxicidade",
    "Love Language": "Linguagem do Amor",
    "Growth Report": "Relatório de Crescimento",
    "Accountability": "Responsabilidade",
    "Energy Report": "Relatório de Energia",
    "Choose your report": "Escolha seu relatório",
    "Who is this chat with?": "Com quem é esta conversa?",
    "This helps the AI frame the analysis correctly.": "Isso ajuda a IA a enquadrar a análise corretamente.",
    "Partner": "Parceiro",
    "Dating": "Ficando",
    "Ex": "Ex",
    "Related": "Família",
    "Friend": "Amigo",
    "Colleague": "Colega",
    "Romantic partner or spouse": "Parceiro romântico ou cônjuge",
    "Seeing each other or early stages": "Se conhecendo ou no começo",
    "Former romantic partner": "Ex-parceiro romântico",
    "Parent, sibling or relative": "Pai, mãe, irmão ou parente",
    "Close friend or bestie": "Amigo próximo ou melhor amigo",
    "Coworker or professional contact": "Colega de trabalho ou contato profissional",
    "Someone you know": "Alguém que você conhece",
    "Reading your messages...": "Lendo suas mensagens...",
    "Finding the patterns...": "Encontrando os padrões...",
    "Figuring out who's funny...": "Descobrindo quem é engraçado...",
    "Detecting the drama...": "Detectando o drama...",
    "Reading between the lines...": "Lendo nas entrelinhas...",
    "Almost done...": "Quase pronto...",
    "Upload different file": "Enviar outro arquivo",
    "Upload your chat": "Envie sua conversa",
    "Reading your chat…": "Lendo sua conversa…",
    "My Results": "Meus resultados",
    "Edit": "Editar",
    "Your chats, unwrapped.": "Seus chats, revelados.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Grupo ou dupla detectado automaticamente. Sua conversa é analisada por IA e nunca armazenada. Apenas os resultados são salvos.",
    "UI language": "Idioma da interface",
    "Report language": "Idioma do relatório",
    "auto": "auto",
    "changed": "alterado",
    "quips.duo.obsessed": [`"{name}, talvez seja bom conferir seu tempo de tela."`,`"{name} está carregando essa conversa no puro fôlego de digitação."`,`"Não é obsessão, é só disponibilidade demais. Claro, {name}."`],
    "quips.duo.responseBalanced": [`"Os dois respondem no mesmo ritmo. Nada de fantasmas aqui."`,`"Ninguém deixa o outro esperando. Raro e bonito."`,`"Os dois aparecem e respondem. Isso sim é equilíbrio."`],
    "quips.duo.ghost": [`"Claro, {name} estava 'ocupado'."`,`"{name}: leu a mensagem e respondeu... eventualmente."`,`"{name} trata resposta como recurso escasso."`],
    "quips.duo.lastWord": [`"{name} manda uma mensagem e a conversa morre ali."`,`"Última cena: a mensagem de {name}, sem resposta."`,`"{name} tem dom para dar a última palavra."`],
    "quips.duo.streak100": [`"{streak} dias. Isso não é sequência, é estilo de vida."`,`"Mais de {streak} dias seguidos. O que quer que seja isso, é real."`,`"{streak} dias seguidos. Consistência séria."`],
    "quips.duo.streak30": [`"{streak} dias sem pausa. Isso é raro."`,`"Mais de um mês aparecendo. Isso significa alguma coisa."`,`"Sem falhas, sem desculpas. Só {streak} dias seguidos."`],
    "quips.duo.streak10": [`"{streak} dias seguidos. Nada mal."`,`"Ok, isso é bem fofo."`,`"Alguma coisa estava funcionando nesses {streak} dias."`],
    "quips.duo.streakShort": [`"{streak} dias. Curto, mas real."`,`"Até uma sequência de {streak} dias conta."`,`"{streak} dias sem se perder de vista já dizem algo."`],
    "quips.duo.convStarter": [`"Alguém está sempre pensando no outro primeiro."`,`"{name} é sempre quem quebra o silêncio."`,`"A primeira mensagem continua vindo de {name}. Isso diz muito."`],
    "quips.duo.messageLengthSimilar": [`"Mensagens quase iguais. Equilíbrio suspeito."`,`"Sem novelista, sem minimalista. Só duas pessoas escrevendo parecido."`,`"Equilibrado. Sem textão, sem resposta de uma palavra."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} trata cada mensagem como carta para a posteridade."`,`"Em algum lugar, {novelist} ainda está digitando."`,`"{texter} responde. {novelist} desenvolve."`],
    "quips.group.mainCharacter": [`"{name}, isso aqui é basicamente seu blog pessoal."`,`"{name} veio para falar e claramente está falando."`,`"Sem {name}, esse grupo virava cemitério."`],
    "quips.group.ghost": [`"{name} está aqui só em espírito."`,`"{name} entrou no grupo e sumiu."`,`"Observador silencioso. Mistério total. {name}."`],
    "quips.group.lastWord": [`"{name} manda uma mensagem. O grupo não responde. Clássico."`,`"Depois da mensagem de {name}, o grupo silencia."`,`"{name} tem o hábito de mandar mensagem para o vazio."`],
    "quips.group.streak100": [`"{streak} dias sem uma única pausa. Esse grupo é diferente."`,`"Mais de {streak} dias seguidos. Isso já é compromisso."`,`"O que mantém esse grupo vivo merecia virar produto."`],
    "quips.group.streak30": [`"{streak} dias aparecendo. Isso é grupo de verdade."`,`"Nem um dia de folga. Esse grupo leva a sério."`,`"A maioria dos grupos morre em duas semanas. Esse não."`],
    "quips.group.streak10": [`"{streak} dias seguidos. O grupo estava vivo."`,`"Vocês realmente gostam uns dos outros. Surpreendente."`,`"{streak} dias seguidos. Mais do que a maioria dos grupos consegue."`],
    "quips.group.streakShort": [`"{streak} dias. Pequeno, mas conta."`,`"Uma sequência de {streak} dias ainda diz algo."`,`"Até {streak} dias seguidos exigem esforço."`],
    "quips.group.novelist": [`"{name} escreve como se não existisse limite de palavras."`,`"{name} manda mensagem com arco completo de história."`,`"Se há um ensaio no grupo, foi {name} que escreveu."`],
    "msgs": "msgs",
    "Red flag {index}": "Sinal de alerta {index}",
    "This pattern showed up enough to feel worth watching.": "Este padrão apareceu vezes suficientes para valer atenção.",
    "Evidence": "Evidência",
    "Who's more obsessed?": "Quem está mais obcecado?",
    "{pct}% of all messages came from {name}.": "{pct}% de todas as mensagens vieram de {name}.",
    "Response times": "Tempos de resposta",
    "Balanced": "Equilibrado",
    "{name} avg reply:": "{name} resp. média:",
    "The Ghost Award": "O Prêmio Fantasma",
    "What's really going on": "O que está realmente acontecendo",
    "The Last Word": "A Última Palavra",
    "Sends the last message that nobody replies to — {count} times.": "Manda a última mensagem que ninguém responde — {count} vezes.",
    "Sends the last message that nobody replies to.": "Manda a última mensagem que ninguém responde.",
    "Your longest streak": "Sua maior sequência",
    "{count} days": "{count} dias",
    "Texted every single day for {count} days straight.": "Mensagens todos os dias por {count} dias seguidos.",
    "The Kindest One": "A Pessoa Mais Gentil",
    "The sweetest moment": "O momento mais doce",
    "Top 3 most active months": "Os 3 meses mais ativos",
    "{month} was your month. Something was going on.": "{month} foi o mês de vocês. Algo estava acontecendo.",
    "Who always reaches out first?": "Quem sempre escreve primeiro?",
    "Started {pct} of all conversations.": "Iniciou {pct}% de todas as conversas.",
    "The Funny One": "O Mais Engraçado",
    "Drops lines like": "Solta frases como",
    "Spirit emojis": "Emojis espírito",
    "These two emojis basically ARE this chat.": "Esses dois emojis basicamente SÃO esse chat.",
    "Top 10 most used words": "As 10 palavras mais usadas",
    "Signature phrases": "Frases características",
    "The phrases that define each of you.": "As frases que definem cada um de vocês.",
    "avg chars": "caract. méd.",
    "longest message": "mensagem mais longa",
    "Media and links": "Mídia e links",
    "Photos & videos": "Fotos e vídeos",
    "Voice memos": "Notas de voz",
    "Links shared": "Links compartilhados",
    "What you actually talk about": "O que vocês realmente falam",
    "Biggest topic": "Tema principal",
    "Most tense moment": "O momento mais tenso",
    "The Drama Report": "O Relatório de Drama",
    "How they do it": "Como fazem isso",
    "Chat vibe": "Vibe do chat",
    "A chaotic, wholesome connection.": "Uma conexão caótica e saudável.",
    "Powered by AI — your messages never left your device.": "Alimentado por IA — suas mensagens nunca saíram do seu dispositivo.",
    "Relationship reading": "Leitura do relacionamento",
    "Observed pattern": "Padrão observado",
    "Concrete example": "Exemplo concreto",
    "Evidence log": "Registro de evidências",
    "What the chat shows": "O que o chat mostra",
    "Toxicity scorecard": "Cartão de toxicidade",
    "Why this person scores highest": "Por que esta pessoa tem a pontuação mais alta",
    "Tension snapshot": "Retrato da tensão",
    "What keeps repeating": "O que fica se repetindo",
    "Main topic": "Tema principal",
    "Pattern note": "Nota sobre o padrão",
    "The strongest pattern is shown above.": "O padrão mais forte é mostrado acima.",
    "Toxicity report": "Relatório de toxicidade",
    "Overall read": "Leitura geral",
    "Score breakdown": "Detalhamento da pontuação",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Este modo serve para mostrar padrões e exemplos, não para decidir por você.",
    "The Main Character": "O Personagem Principal",
    "The Ghost": "O Fantasma",
    "{count} messages total. Why are they even here?": "{count} mensagens no total. Por que estão aqui mesmo?",
    "The group was most alive in {month}.": "O grupo esteve mais ativo em {month}.",
    "Longest active streak": "Maior sequência ativa",
    "The group kept the chat alive for {count} days straight.": "O grupo manteve o chat vivo por {count} dias seguidos.",
    "The Hype Person": "O Animador do Grupo",
    "Started {pct} of all conversations. The engine of this group.": "Iniciou {pct}% de todas as conversas. O motor do grupo.",
    "Why {name} is the hype": "Por que {name} anima o grupo",
    "Group spirit emoji": "Emoji espírito do grupo",
    "This one emoji basically summarises the entire group energy.": "Esse emoji basicamente resume toda a energia do grupo.",
    "The Novelist": "O Romancista",
    "Their longest message was mostly about \"{topic}\".": "Sua mensagem mais longa foi principalmente sobre \"{topic}\".",
    "The inside joke": "A piada interna",
    "Most missed member": "O membro que mais faz falta",
    "When they go quiet, the group feels it.": "Quando ficam em silêncio, o grupo sente.",
    "The group read": "A leitura do grupo",
    "Group dynamic": "Dinâmica do grupo",
    "Group vibe": "Vibe do grupo",
    "Chaotic. Wholesome. Somehow still going.": "Caótico. Saudável. De algum jeito ainda está rolando.",
    "Group pattern read": "Leitura do padrão do grupo",
    "Support and strain": "Apoio e tensão",
    "Who keeps it going": "Quem mantém vivo",
    "{name} started {pct} of conversations.": "{name} iniciou {pct}% das conversas.",
    "The group shares the conversation starts.": "O grupo divide os inícios das conversas.",
    "Who goes quiet": "Quem fica em silêncio",
    "{name} is the least active member in the sampled history.": "{name} é o membro menos ativo no histórico analisado.",
    "No clear ghost in this sample.": "Sem fantasma claro nesta amostra.",
    "Chat Health Score": "Pontuação de Saúde do Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "De 10 — baseado em padrões de conflito, estilo de comunicação e dinâmica geral.",
    "Verdict": "Veredicto",
    "Individual health scores": "Pontuações individuais de saúde",
    "Who apologises more": "Quem pede mais desculpas",
    "Red flag moments": "Momentos de alerta",
    "Conflict pattern": "Padrão de conflito",
    "How arguments unfold": "Como as discussões se desenvolvem",
    "Power balance": "Equilíbrio de poder",
    "Power dynamic": "Dinâmica de poder",
    "The verdict": "O veredicto",
    "Overall chat health score.": "Pontuação geral de saúde do chat.",
    "Final read": "Leitura final",
    "Reflects patterns in this sample — not a final judgment.": "Reflete padrões nesta amostra — não é um julgamento final.",
    "{name}'s love language": "A linguagem do amor de {name}",
    "How they show it": "Como demonstra",
    "The language gap": "A diferença de linguagem",
    "Do they speak the same language?": "Falam a mesma linguagem?",
    "Most loving moment": "O momento mais amoroso",
    "The moment": "O momento",
    "Love language compatibility": "Compatibilidade de linguagem do amor",
    "Compatibility read": "Leitura de compatibilidade",
    "Then vs Now": "Antes vs Agora",
    "Early messages": "Mensagens iniciais",
    "Recent messages": "Mensagens recentes",
    "Who changed more": "Quem mudou mais",
    "How they changed": "Como mudaram",
    "What changed in the chat": "O que mudou no chat",
    "Topics that appeared": "Temas que surgiram",
    "Topics that faded": "Temas que sumiram",
    "Relationship trajectory": "Trajetória do relacionamento",
    "What the data shows": "O que os dados mostram",
    "The arc": "O arco",
    "Promises made": "Promessas feitas",
    "promises": "promessas",
    "Overall verdict": "Veredicto geral",
    "{name}'s accountability": "Responsabilidade de {name}",
    "kept": "cumpridas",
    "broken": "quebradas",
    "Pattern": "Padrão",
    "Most notable broken promise": "A promessa quebrada mais notável",
    "Most notable kept promise": "A promessa cumprida mais notável",
    "Net energy scores": "Pontuações líquidas de energia",
    "Energy compatibility": "Compatibilidade de energia",
    "{name}'s energy": "A energia de {name}",
    "Positive energy": "Energia positiva",
    "Draining patterns": "Padrões desgastantes",
    "Most energising moment": "O momento mais energizante",
    "Most draining moment": "O momento mais desgastante",
    "messages": "mensagens",
    "Your relationship, in data.": "Seu relacionamento, em dados.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Lê seu chat do WhatsApp e mostra o que está realmente acontecendo. Quem aparece. Quem some. Quem carrega a conversa.",
    "Skip": "Pular",
    "Start with your chat.": "Comece com seu chat.",
    "Upload. Analyse. See it clearly.": "Envie. Analise. Veja com clareza.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Seis relatórios. Toxicidade, linguagens do amor, responsabilidade, energia, crescimento e seu chat completo resumido. Resultados em menos de um minuto.",
    "Log out": "Sair",
    "Feedback Inbox": "Caixa de feedback",
    "Large group detected — analysing the top {cap} members out of {count}.": "Grupo grande detectado — analisando os {cap} membros mais ativos de {count}.",
  },
  ar: {
    "Choose your language": "اختر لغتك",
    "English": "الإنجليزية",
    "Auto-detect": "كشف تلقائي",
    "Continue": "متابعة",
    "Back": "رجوع",
    "Next": "التالي",
    "See summary": "عرض الملخص",
    "Done": "تم",
    "Start over": "ابدأ من جديد",
    "Share": "مشاركة",
    "What's off about this?": "ما غير الصحيح هنا؟",
    "Optional note": "ملاحظة اختيارية",
    "Cancel": "إلغاء",
    "Submit": "إرسال",
    "Sending…": "جارٍ الإرسال…",
    "Got it, thank you.": "وصلت، شكرًا لك.",
    "Events are mixing": "الأحداث مختلطة",
    "Wrong person": "الشخص غير صحيح",
    "Didn't happen": "لم يحدث",
    "Tone misread": "تم فهم النبرة بشكل خاطئ",
    "Overclaiming": "استنتاج مبالغ فيه",
    "Missing context": "السياق ناقص",
    "Other": "أخرى",
    "The Roast": "التحميص",
    "The Lovely": "اللطيف",
    "The Funny": "المضحك",
    "The Stats": "الإحصاءات",
    "Insight": "رؤية",
    "WrapChat": "WrapChat",
    "Toxicity Report": "تقرير السمية",
    "Love Language": "لغة الحب",
    "Growth Report": "تقرير التطور",
    "Accountability": "المساءلة",
    "Energy Report": "تقرير الطاقة",
    "Choose your report": "اختر تقريرك",
    "Who is this chat with?": "مع من هذه المحادثة؟",
    "This helps the AI frame the analysis correctly.": "هذا يساعد الذكاء الاصطناعي على فهم التحليل بشكل صحيح.",
    "Partner": "شريك",
    "Dating": "مواعدة",
    "Ex": "حبيب سابق",
    "Related": "عائلة",
    "Friend": "صديق",
    "Colleague": "زميل",
    "Romantic partner or spouse": "شريك عاطفي أو زوج/زوجة",
    "Seeing each other or early stages": "تعارف أو بداية العلاقة",
    "Former romantic partner": "شريك عاطفي سابق",
    "Parent, sibling or relative": "أب أو أم أو أخ أو قريب",
    "Close friend or bestie": "صديق مقرب أو أعز صديق",
    "Coworker or professional contact": "زميل عمل أو جهة اتصال مهنية",
    "Someone you know": "شخص تعرفه",
    "Reading your messages...": "جارٍ قراءة رسائلك...",
    "Finding the patterns...": "جارٍ العثور على الأنماط...",
    "Figuring out who's funny...": "جارٍ معرفة من هو المضحك...",
    "Detecting the drama...": "جارٍ رصد الدراما...",
    "Reading between the lines...": "جارٍ القراءة بين السطور...",
    "Almost done...": "اقتربنا من الانتهاء...",
    "Upload different file": "ارفع ملفًا آخر",
    "Upload your chat": "ارفع محادثتك",
    "Reading your chat…": "جارٍ قراءة محادثتك…",
    "My Results": "نتائجي",
    "Edit": "تعديل",
    "Your chats, unwrapped.": "محادثاتك كما هي.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "يتم اكتشاف المجموعة أو المحادثة الثنائية تلقائيًا. يتم تحليل محادثتك بالذكاء الاصطناعي ولا يتم حفظها أبدًا. يتم حفظ النتائج فقط.",
    "UI language": "لغة الواجهة",
    "Report language": "لغة التقرير",
    "auto": "تلقائي",
    "changed": "تم التغيير",
    "quips.duo.obsessed": [`"{name}، ربما عليك مراجعة وقت الشاشة."`,`"{name} يحمل هذه المحادثة بقوة الأصابع فقط."`,`"ليس هوسًا، فقط حضور زائد جدًا. طبعًا يا {name}."`],
    "quips.duo.responseBalanced": [`"كلاكما يرد بالسرعة نفسها. لا أشباح هنا."`,`"لا أحد يترك الآخر منتظرًا. شيء جميل فعلًا."`,`"كلاكما حاضر ويرد. هكذا يبدو التوازن."`],
    "quips.duo.ghost": [`"أكيد كان {name} 'مشغولًا'."`,`"{name}: قرأ الرسالة ورد... في وقت ما لاحقًا."`,`"{name} يتعامل مع الردود كأنها مورد محدود."`],
    "quips.duo.lastWord": [`"{name} يرسل رسالة وتنتهي المحادثة هناك."`,`"آخر ما شوهد: رسالة {name} بلا رد."`,`"{name} لديه موهبة في قول الكلمة الأخيرة."`],
    "quips.duo.streak100": [`"{streak} يومًا. هذه ليست سلسلة بل أسلوب حياة."`,`"أكثر من {streak} يومًا متتاليًا. أيًا كان هذا فهو حقيقي."`,`"{streak} يومًا متتاليًا. هذا ثبات جاد."`],
    "quips.duo.streak30": [`"{streak} يومًا بلا انقطاع. هذا نادر."`,`"أكثر من شهر من الحضور المستمر. هذا يعني شيئًا."`,`"لا فجوات ولا أعذار. فقط {streak} يومًا متتاليًا."`],
    "quips.duo.streak10": [`"{streak} أيام متتالية. ليس سيئًا أبدًا."`,`"حسنًا، هذا لطيف فعلًا."`,`"كان هناك شيء يسير بشكل جيد خلال {streak} أيام."`],
    "quips.duo.streakShort": [`"{streak} أيام. قصيرة لكنها حقيقية."`,`"حتى سلسلة من {streak} أيام تُحسب."`,`"{streak} أيام من عدم الانقطاع ما زالت تعني شيئًا."`],
    "quips.duo.convStarter": [`"هناك من يفكر في الآخر أولًا كل مرة."`,`"{name} هو دائمًا من يكسر الصمت أولًا."`,`"الرسالة الأولى ما زالت تأتي من {name}. هذا يقول الكثير."`],
    "quips.duo.messageLengthSimilar": [`"طول الرسائل متقارب جدًا. توازن مريب."`,`"لا روائي هنا ولا مقتصد. فقط شخصان يكتبان بالمقدار نفسه تقريبًا."`,`"متوازن. لا مقالات طويلة ولا ردود بكلمة واحدة."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} يتعامل مع كل رسالة كأنها رسالة للتاريخ."`,`"في مكان ما، ما زال {novelist} يكتب."`,`"{texter} يرد، أما {novelist} فيكتب فصلًا."`],
    "quips.group.mainCharacter": [`"{name}، هذه المدونة الشخصية الخاصة بك تقريبًا."`,`"{name} جاء ليتكلم وهو يفعل ذلك فعلًا."`,`"من دون {name} يصبح هذا الشات مقبرة."`],
    "quips.group.ghost": [`"{name} موجود بالروح فقط."`,`"{name} دخل المجموعة ثم اختفى فورًا."`,`"مراقب صامت. لغز كامل. {name}."`],
    "quips.group.lastWord": [`"{name} يرسل رسالة. المجموعة لا ترد. كلاسيكي."`,`"بعد رسالة {name} تصمت المجموعة كل مرة."`,`"{name} اعتاد إرسال الرسائل إلى الفراغ."`],
    "quips.group.streak100": [`"{streak} يومًا بلا أي انقطاع. هذه المجموعة مختلفة."`,`"أكثر من {streak} يومًا متتاليًا. هذا التزام حقيقي."`,`"ما يُبقي هذه المجموعة حية يستحق أن يُباع."`],
    "quips.group.streak30": [`"{streak} يومًا من الظهور المستمر. هذه مجموعة حقيقية."`,`"ولا يوم راحة واحد. هذه المجموعة تأخذ الأمر بجدية."`,`"معظم المجموعات تموت خلال أسبوعين. هذه لا."`],
    "quips.group.streak10": [`"{streak} أيام متتالية. كانت المجموعة حية فعلًا."`,`"يبدو أنكم فعلًا تحبون بعضكم. مفاجأة."`,`"{streak} أيام متتالية. أكثر مما تفعله معظم المجموعات."`],
    "quips.group.streakShort": [`"{streak} أيام. قليل لكنه يُحسب."`,`"حتى سلسلة من {streak} أيام تعني أن شيئًا ما كان يحدث."`,`"حتى {streak} أيام متتالية تحتاج جهدًا."`],
    "quips.group.novelist": [`"{name} يكتب وكأنه لا يوجد حد للكلمات."`,`"{name} يرسل رسائل فيها تطور كامل للحبكة."`,`"إذا كان هناك مقال في المجموعة فقد كتبه {name}."`],
    "msgs": "رسائل",
    "Red flag {index}": "علامة تحذير {index}",
    "This pattern showed up enough to feel worth watching.": "ظهر هذا النمط بما يكفي ليستحق الانتباه.",
    "Evidence": "دليل",
    "Who's more obsessed?": "من هو الأكثر هوساً؟",
    "{pct}% of all messages came from {name}.": "{pct}٪ من جميع الرسائل جاءت من {name}.",
    "Response times": "أوقات الرد",
    "Balanced": "متوازن",
    "{name} avg reply:": "متوسط رد {name}:",
    "The Ghost Award": "جائزة الشبح",
    "What's really going on": "ما الذي يحدث فعلاً",
    "The Last Word": "الكلمة الأخيرة",
    "Sends the last message that nobody replies to — {count} times.": "يرسل آخر رسالة لا يرد عليها أحد — {count} مرة.",
    "Sends the last message that nobody replies to.": "يرسل آخر رسالة لا يرد عليها أحد.",
    "Your longest streak": "أطول سلسلة لك",
    "{count} days": "{count} أيام",
    "Texted every single day for {count} days straight.": "تراسلتم كل يوم لمدة {count} أيام متتالية.",
    "The Kindest One": "أكثرهم لطفاً",
    "The sweetest moment": "أجمل لحظة",
    "Top 3 most active months": "أكثر 3 أشهر نشاطاً",
    "{month} was your month. Something was going on.": "{month} كان شهركم. كان ثمة شيء يحدث.",
    "Who always reaches out first?": "من يكتب أولاً دائماً؟",
    "Started {pct} of all conversations.": "بدأ {pct}٪ من جميع المحادثات.",
    "The Funny One": "الأكثر طرافة",
    "Drops lines like": "يلقي عبارات مثل",
    "Spirit emojis": "رموز الروح",
    "These two emojis basically ARE this chat.": "هذان الرمزان هما هذا الدردشة بالأساس.",
    "Top 10 most used words": "أكثر 10 كلمات استخداماً",
    "Signature phrases": "العبارات المميزة",
    "The phrases that define each of you.": "العبارات التي تُعرّف كل واحد منكم.",
    "avg chars": "متوسط الأحرف",
    "longest message": "أطول رسالة",
    "Media and links": "الوسائط والروابط",
    "Photos & videos": "الصور ومقاطع الفيديو",
    "Voice memos": "الرسائل الصوتية",
    "Links shared": "الروابط المشاركة",
    "What you actually talk about": "ما الذي تتحدثون عنه فعلاً",
    "Biggest topic": "الموضوع الرئيسي",
    "Most tense moment": "اللحظة الأشد توتراً",
    "The Drama Report": "تقرير الدراما",
    "How they do it": "كيف يفعل ذلك",
    "Chat vibe": "أجواء المحادثة",
    "A chaotic, wholesome connection.": "تواصل فوضوي لكنه صحي.",
    "Powered by AI — your messages never left your device.": "مدعوم بالذكاء الاصطناعي — رسائلك لم تغادر جهازك قط.",
    "Relationship reading": "قراءة العلاقة",
    "Observed pattern": "النمط الملاحظ",
    "Concrete example": "مثال ملموس",
    "Evidence log": "سجل الأدلة",
    "What the chat shows": "ما تُظهره المحادثة",
    "Toxicity scorecard": "بطاقة السمية",
    "Why this person scores highest": "لماذا حصل هذا الشخص على أعلى نقاط",
    "Tension snapshot": "لقطة التوتر",
    "What keeps repeating": "ما يتكرر باستمرار",
    "Main topic": "الموضوع الرئيسي",
    "Pattern note": "ملاحظة النمط",
    "The strongest pattern is shown above.": "النمط الأقوى موضح أعلاه.",
    "Toxicity report": "تقرير السمية",
    "Overall read": "القراءة العامة",
    "Score breakdown": "تفصيل النقاط",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "هذا الوضع مصمم لإظهار الأنماط والأمثلة، وليس لاتخاذ القرار نيابةً عنك.",
    "The Main Character": "الشخصية الرئيسية",
    "The Ghost": "الشبح",
    "{count} messages total. Why are they even here?": "{count} رسالة إجمالاً. لماذا هم هنا أصلاً؟",
    "The group was most alive in {month}.": "كانت المجموعة في أوج نشاطها في {month}.",
    "Longest active streak": "أطول سلسلة نشاط",
    "The group kept the chat alive for {count} days straight.": "حافظت المجموعة على استمرار الدردشة لمدة {count} أيام متتالية.",
    "The Hype Person": "محرك الحماس",
    "Started {pct} of all conversations. The engine of this group.": "بدأ {pct}٪ من جميع المحادثات. محرك هذه المجموعة.",
    "Why {name} is the hype": "لماذا {name} هو مصدر الحماس",
    "Group spirit emoji": "رمز روح المجموعة",
    "This one emoji basically summarises the entire group energy.": "هذا الرمز يلخص بشكل أساسي طاقة المجموعة بأكملها.",
    "The Novelist": "كاتب الروايات",
    "Their longest message was mostly about \"{topic}\".": "كانت رسالتهم الأطول تتناول بشكل رئيسي \"{topic}\".",
    "The inside joke": "النكتة الداخلية",
    "Most missed member": "العضو الأكثر افتقاداً",
    "When they go quiet, the group feels it.": "حين يصمتون، تشعر المجموعة بذلك.",
    "The group read": "قراءة المجموعة",
    "Group dynamic": "ديناميكية المجموعة",
    "Group vibe": "أجواء المجموعة",
    "Chaotic. Wholesome. Somehow still going.": "فوضوي. صحي. ولا يزال مستمراً بطريقة ما.",
    "Group pattern read": "قراءة نمط المجموعة",
    "Support and strain": "الدعم والضغط",
    "Who keeps it going": "من يُبقيها مستمرة",
    "{name} started {pct} of conversations.": "بدأ {name} {pct}٪ من المحادثات.",
    "The group shares the conversation starts.": "تُشارك المجموعة في بدء المحادثات.",
    "Who goes quiet": "من يصمت",
    "{name} is the least active member in the sampled history.": "{name} هو العضو الأقل نشاطاً في السجل المحلل.",
    "No clear ghost in this sample.": "لا يوجد شبح واضح في هذه العينة.",
    "Chat Health Score": "نقاط صحة المحادثة",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "من 10 — بناءً على أنماط الصراع وأسلوب التواصل والديناميكية العامة.",
    "Verdict": "الحكم",
    "Individual health scores": "نقاط الصحة الفردية",
    "Who apologises more": "من يعتذر أكثر",
    "Red flag moments": "لحظات الإنذار",
    "Conflict pattern": "نمط الصراع",
    "How arguments unfold": "كيف تتطور الخلافات",
    "Power balance": "توازن القوى",
    "Power dynamic": "ديناميكية القوة",
    "The verdict": "الحكم",
    "Overall chat health score.": "نقاط الصحة العامة للمحادثة.",
    "Final read": "القراءة النهائية",
    "Reflects patterns in this sample — not a final judgment.": "يعكس أنماطاً في هذه العينة — وليس حكماً نهائياً.",
    "{name}'s love language": "لغة الحب عند {name}",
    "How they show it": "كيف يُظهر ذلك",
    "The language gap": "الفجوة اللغوية",
    "Do they speak the same language?": "هل يتحدثان اللغة ذاتها؟",
    "Most loving moment": "أكثر لحظة حنواً",
    "The moment": "اللحظة",
    "Love language compatibility": "توافق لغة الحب",
    "Compatibility read": "قراءة التوافق",
    "Then vs Now": "الماضي مقابل الحاضر",
    "Early messages": "الرسائل الأولى",
    "Recent messages": "الرسائل الأخيرة",
    "Who changed more": "من تغير أكثر",
    "How they changed": "كيف تغيروا",
    "What changed in the chat": "ما الذي تغير في المحادثة",
    "Topics that appeared": "الموضوعات التي ظهرت",
    "Topics that faded": "الموضوعات التي تلاشت",
    "Relationship trajectory": "مسار العلاقة",
    "What the data shows": "ما تُظهره البيانات",
    "The arc": "القوس",
    "Promises made": "الوعود المُعطاة",
    "promises": "وعود",
    "Overall verdict": "الحكم العام",
    "{name}'s accountability": "مسؤولية {name}",
    "kept": "مُوفَّى بها",
    "broken": "مُخلَف بها",
    "Pattern": "النمط",
    "Most notable broken promise": "الوعد المُخلَف الأبرز",
    "Most notable kept promise": "الوعد المُوفَّى الأبرز",
    "Net energy scores": "نقاط الطاقة الصافية",
    "Energy compatibility": "توافق الطاقة",
    "{name}'s energy": "طاقة {name}",
    "Positive energy": "طاقة إيجابية",
    "Draining patterns": "أنماط مُستنزِفة",
    "Most energising moment": "أكثر لحظة محفزة للطاقة",
    "Most draining moment": "أكثر لحظة مُستنزِفة",
    "messages": "رسائل",
    "Your relationship, in data.": "علاقتك، في بيانات.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "يقرأ محادثتك على واتساب ويُريك ما يحدث فعلاً. من يظهر. من يختفي. من يحمل المحادثة.",
    "Skip": "تخطي",
    "Start with your chat.": "ابدأ بمحادثتك.",
    "Upload. Analyse. See it clearly.": "ارفع. حلّل. انظر بوضوح.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "ستة تقارير. السمية، لغات الحب، المسؤولية، الطاقة، النمو، وملخص محادثتك الكاملة. نتائج في أقل من دقيقة.",
    "Log out": "تسجيل الخروج",
    "Feedback Inbox": "صندوق التعليقات",
    "Large group detected — analysing the top {cap} members out of {count}.": "تم اكتشاف مجموعة كبيرة — يتم تحليل أكثر {cap} أعضاء نشاطاً من أصل {count}.",
  },
  fr: {
    "Choose your language": "Choisissez votre langue",
    "English": "Anglais",
    "Auto-detect": "Détection automatique",
    "Continue": "Continuer",
    "Back": "Retour",
    "Next": "Suivant",
    "See summary": "Voir le résumé",
    "Done": "Terminé",
    "Start over": "Recommencer",
    "Share": "Partager",
    "What's off about this?": "Qu'est-ce qui ne va pas ici ?",
    "Optional note": "Note facultative",
    "Cancel": "Annuler",
    "Submit": "Envoyer",
    "Sending…": "Envoi…",
    "Got it, thank you.": "Bien noté, merci.",
    "Events are mixing": "Les événements sont mélangés",
    "Wrong person": "Mauvaise personne",
    "Didn't happen": "Ça ne s'est pas produit",
    "Tone misread": "Le ton est mal interprété",
    "Overclaiming": "Conclusion trop poussée",
    "Missing context": "Contexte manquant",
    "Other": "Autre",
    "The Roast": "Le Roast",
    "The Lovely": "Le Doux",
    "The Funny": "Le Drôle",
    "The Stats": "Les Stats",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Rapport de Toxicité",
    "Love Language": "Langage de l'Amour",
    "Growth Report": "Rapport d'Évolution",
    "Accountability": "Responsabilité",
    "Energy Report": "Rapport d'Énergie",
    "Choose your report": "Choisissez votre rapport",
    "Who is this chat with?": "Avec qui est ce chat ?",
    "This helps the AI frame the analysis correctly.": "Cela aide l'IA à cadrer correctement l'analyse.",
    "Partner": "Partenaire",
    "Dating": "Fréquentation",
    "Ex": "Ex",
    "Related": "Famille",
    "Friend": "Ami",
    "Colleague": "Collègue",
    "Romantic partner or spouse": "Partenaire romantique ou conjoint",
    "Seeing each other or early stages": "Vous vous voyez ou c'est le début",
    "Former romantic partner": "Ancien partenaire romantique",
    "Parent, sibling or relative": "Parent, frère, sœur ou proche",
    "Close friend or bestie": "Ami proche ou meilleur ami",
    "Coworker or professional contact": "Collègue ou contact professionnel",
    "Someone you know": "Quelqu'un que vous connaissez",
    "Reading your messages...": "Lecture de vos messages...",
    "Finding the patterns...": "Recherche des schémas...",
    "Figuring out who's funny...": "On cherche qui est drôle...",
    "Detecting the drama...": "Détection du drama...",
    "Reading between the lines...": "Lecture entre les lignes...",
    "Almost done...": "Presque fini...",
    "Upload different file": "Téléverser un autre fichier",
    "Upload your chat": "Téléversez votre chat",
    "Reading your chat…": "Lecture de votre chat…",
    "My Results": "Mes résultats",
    "Edit": "Modifier",
    "Your chats, unwrapped.": "Vos chats, déballés.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Groupe ou duo détecté automatiquement. Votre chat est analysé par l'IA et n'est jamais stocké. Seuls les résultats sont enregistrés.",
    "UI language": "Langue de l'interface",
    "Report language": "Langue du rapport",
    "auto": "auto",
    "changed": "modifié",
    "quips.duo.obsessed": [`"{name}, tu devrais peut-être regarder ton temps d'écran."`,`"{name} porte cette conversation à la seule force des pouces."`,`"Pas obsédé, juste très disponible. Bien sûr, {name}."`],
    "quips.duo.responseBalanced": [`"Vous répondez tous les deux au même rythme. Pas de fantôme ici."`,`"Personne ne fait attendre l'autre. C'est rare."`,`"Vous êtes présents tous les deux. Voilà à quoi ressemble l'équilibre."`],
    "quips.duo.ghost": [`"Bien sûr, {name} était 'occupé'."`,`"{name} : a lu le message et a répondu... plus tard."`,`"{name} traite les réponses comme une ressource limitée."`],
    "quips.duo.lastWord": [`"{name} envoie un message et la conversation s'arrête là."`,`"Dernière image : le message de {name}, sans réponse."`,`"{name} a un vrai talent pour avoir le dernier mot."`],
    "quips.duo.streak100": [`"{streak} jours. Ce n'est plus une série, c'est un mode de vie."`,`"Plus de {streak} jours d'affilée. Quoi que ce soit, c'est réel."`,`"{streak} jours d'affilée. Une vraie régularité."`],
    "quips.duo.streak30": [`"{streak} jours sans trou. C'est rare."`,`"Plus d'un mois de présence continue. Ça veut dire quelque chose."`,`"Pas de pause, pas d'excuse. Juste {streak} jours d'affilée."`],
    "quips.duo.streak10": [`"{streak} jours d'affilée. Pas mal du tout."`,`"Bon, c'est franchement mignon."`,`"Quelque chose marchait clairement pendant ces {streak} jours."`],
    "quips.duo.streakShort": [`"{streak} jours. Court, mais réel."`,`"Même une série de {streak} jours compte."`,`"{streak} jours sans se manquer, ça compte aussi."`],
    "quips.duo.convStarter": [`"Quelqu'un pense toujours à l'autre en premier."`,`"{name} est toujours celui qui brise le silence en premier."`,`"Le premier message vient encore de {name}. Ça en dit long."`],
    "quips.duo.messageLengthSimilar": [`"Longueur des messages presque identique. Suspectement équilibré."`,`"Pas de romancier ici, pas de minimaliste non plus. Juste deux personnes qui écrivent pareil."`,`"Équilibré. Ni romans, ni réponses en un mot."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} traite chaque texto comme une lettre à la postérité."`,`"Quelque part, {novelist} est encore en train d'écrire."`,`"{texter} répond. {novelist} développe."`],
    "quips.group.mainCharacter": [`"{name}, ce groupe est pratiquement ton blog personnel."`,`"{name} est venu parler, et ça se voit."`,`"Sans {name}, ce chat serait un cimetière."`],
    "quips.group.ghost": [`"{name} n'est là qu'en esprit."`,`"{name} a rejoint le groupe puis a disparu."`,`"Observateur silencieux. Mystère complet. {name}."`],
    "quips.group.lastWord": [`"{name} envoie un message. Le groupe ne répond pas. Classique."`,`"Après le message de {name}, le groupe se tait à chaque fois."`,`"{name} a l'habitude d'envoyer des messages dans le vide."`],
    "quips.group.streak100": [`"{streak} jours sans une seule pause. Ce groupe est à part."`,`"Plus de {streak} jours d'affilée. Là, on parle d'engagement."`,`"Ce qui garde ce groupe vivant devrait être mis en bouteille."`],
    "quips.group.streak30": [`"{streak} jours de présence. C'est un vrai groupe."`,`"Pas un seul jour de pause. Ce groupe est investi."`,`"La plupart des groupes meurent en deux semaines. Pas celui-ci."`],
    "quips.group.streak10": [`"{streak} jours d'affilée. Le groupe était vivant."`,`"Vous vous aimez vraiment bien. Surprise."`,`"{streak} jours d'affilée. Plus que la plupart des groupes."`],
    "quips.group.streakShort": [`"{streak} jours. Petit, mais ça compte."`,`"Même une série de {streak} jours veut dire quelque chose."`,`"Même {streak} jours d'affilée demandent un effort."`],
    "quips.group.novelist": [`"{name} écrit comme s'il n'y avait aucune limite de mots."`,`"{name} envoie des messages avec un vrai arc narratif."`,`"S'il y a une dissertation dans le groupe, c'est {name} qui l'a écrite."`],
    "msgs": "msgs",
    "Red flag {index}": "Signal d'alerte {index}",
    "This pattern showed up enough to feel worth watching.": "Ce schéma est apparu assez souvent pour mériter attention.",
    "Evidence": "Preuve",
    "Who's more obsessed?": "Qui est le plus obsédé ?",
    "{pct}% of all messages came from {name}.": "{pct}% de tous les messages viennent de {name}.",
    "Response times": "Temps de réponse",
    "Balanced": "Équilibré",
    "{name} avg reply:": "{name} rép. moy. :",
    "The Ghost Award": "Le Prix Fantôme",
    "What's really going on": "Ce qui se passe vraiment",
    "The Last Word": "Le Dernier Mot",
    "Sends the last message that nobody replies to — {count} times.": "Envoie le dernier message sans réponse — {count} fois.",
    "Sends the last message that nobody replies to.": "Envoie le dernier message sans réponse.",
    "Your longest streak": "Votre plus longue série",
    "{count} days": "{count} jours",
    "Texted every single day for {count} days straight.": "Messages chaque jour pendant {count} jours d'affilée.",
    "The Kindest One": "La Personne La Plus Gentille",
    "The sweetest moment": "Le moment le plus doux",
    "Top 3 most active months": "Les 3 mois les plus actifs",
    "{month} was your month. Something was going on.": "{month} était votre mois. Il se passait quelque chose.",
    "Who always reaches out first?": "Qui écrit toujours en premier ?",
    "Started {pct} of all conversations.": "A lancé {pct}% de toutes les conversations.",
    "The Funny One": "Le Plus Drôle",
    "Drops lines like": "Balance des vannes comme",
    "Spirit emojis": "Emojis esprits",
    "These two emojis basically ARE this chat.": "Ces deux emojis SONT littéralement ce chat.",
    "Top 10 most used words": "Les 10 mots les plus utilisés",
    "Signature phrases": "Phrases caractéristiques",
    "The phrases that define each of you.": "Les phrases qui définissent chacun de vous.",
    "avg chars": "caract. moy.",
    "longest message": "message le plus long",
    "Media and links": "Médias et liens",
    "Photos & videos": "Photos et vidéos",
    "Voice memos": "Notes vocales",
    "Links shared": "Liens partagés",
    "What you actually talk about": "De quoi vous parlez vraiment",
    "Biggest topic": "Sujet principal",
    "Most tense moment": "Le moment le plus tendu",
    "The Drama Report": "Le Rapport Drama",
    "How they do it": "Comment ils le font",
    "Chat vibe": "Ambiance du chat",
    "A chaotic, wholesome connection.": "Un lien chaotique mais sain.",
    "Powered by AI — your messages never left your device.": "Alimenté par l'IA — vos messages n'ont jamais quitté votre appareil.",
    "Relationship reading": "Lecture de la relation",
    "Observed pattern": "Schéma observé",
    "Concrete example": "Exemple concret",
    "Evidence log": "Journal de preuves",
    "What the chat shows": "Ce que montre le chat",
    "Toxicity scorecard": "Tableau de toxicité",
    "Why this person scores highest": "Pourquoi cette personne a le score le plus élevé",
    "Tension snapshot": "Aperçu de la tension",
    "What keeps repeating": "Ce qui se répète",
    "Main topic": "Sujet principal",
    "Pattern note": "Note sur le schéma",
    "The strongest pattern is shown above.": "Le schéma le plus fort est affiché ci-dessus.",
    "Toxicity report": "Rapport de toxicité",
    "Overall read": "Lecture globale",
    "Score breakdown": "Détail des scores",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Ce mode est conçu pour faire ressortir des schémas et des exemples, pas pour décider à votre place.",
    "The Main Character": "Le Personnage Principal",
    "The Ghost": "Le Fantôme",
    "{count} messages total. Why are they even here?": "{count} messages au total. Pourquoi sont-ils là d'ailleurs ?",
    "The group was most alive in {month}.": "Le groupe était le plus actif en {month}.",
    "Longest active streak": "Plus longue série active",
    "The group kept the chat alive for {count} days straight.": "Le groupe a maintenu le chat vivant pendant {count} jours d'affilée.",
    "The Hype Person": "L'Animateur du Groupe",
    "Started {pct} of all conversations. The engine of this group.": "A lancé {pct}% de toutes les conversations. Le moteur de ce groupe.",
    "Why {name} is the hype": "Pourquoi {name} anime le groupe",
    "Group spirit emoji": "Emoji esprit du groupe",
    "This one emoji basically summarises the entire group energy.": "Cet emoji résume à lui seul toute l'énergie du groupe.",
    "The Novelist": "Le Romancier",
    "Their longest message was mostly about \"{topic}\".": "Leur message le plus long portait surtout sur \"{topic}\".",
    "The inside joke": "La blague interne",
    "Most missed member": "Le membre qui manque le plus",
    "When they go quiet, the group feels it.": "Quand ils se taisent, le groupe le ressent.",
    "The group read": "La lecture du groupe",
    "Group dynamic": "Dynamique du groupe",
    "Group vibe": "Ambiance du groupe",
    "Chaotic. Wholesome. Somehow still going.": "Chaotique. Sain. Et pourtant toujours là.",
    "Group pattern read": "Lecture du schéma du groupe",
    "Support and strain": "Soutien et tension",
    "Who keeps it going": "Qui maintient le groupe en vie",
    "{name} started {pct} of conversations.": "{name} a lancé {pct}% des conversations.",
    "The group shares the conversation starts.": "Le groupe partage les débuts de conversation.",
    "Who goes quiet": "Qui se tait",
    "{name} is the least active member in the sampled history.": "{name} est le membre le moins actif dans l'historique analysé.",
    "No clear ghost in this sample.": "Pas de fantôme évident dans cet échantillon.",
    "Chat Health Score": "Score de Santé du Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Sur 10 — basé sur les schémas de conflit, le style de communication et la dynamique générale.",
    "Verdict": "Verdict",
    "Individual health scores": "Scores de santé individuels",
    "Who apologises more": "Qui s'excuse le plus",
    "Red flag moments": "Moments d'alerte",
    "Conflict pattern": "Schéma de conflit",
    "How arguments unfold": "Comment les disputes se déroulent",
    "Power balance": "Équilibre du pouvoir",
    "Power dynamic": "Dynamique du pouvoir",
    "The verdict": "Le verdict",
    "Overall chat health score.": "Score de santé global du chat.",
    "Final read": "Lecture finale",
    "Reflects patterns in this sample — not a final judgment.": "Reflète des schémas dans cet échantillon — pas un jugement définitif.",
    "{name}'s love language": "Le langage de l'amour de {name}",
    "How they show it": "Comment ils le montrent",
    "The language gap": "Le fossé de langage",
    "Do they speak the same language?": "Parlent-ils le même langage ?",
    "Most loving moment": "Le moment le plus tendre",
    "The moment": "Le moment",
    "Love language compatibility": "Compatibilité de langage de l'amour",
    "Compatibility read": "Lecture de compatibilité",
    "Then vs Now": "Avant vs Maintenant",
    "Early messages": "Messages du début",
    "Recent messages": "Messages récents",
    "Who changed more": "Qui a le plus changé",
    "How they changed": "Comment ils ont changé",
    "What changed in the chat": "Ce qui a changé dans le chat",
    "Topics that appeared": "Sujets apparus",
    "Topics that faded": "Sujets disparus",
    "Relationship trajectory": "Trajectoire de la relation",
    "What the data shows": "Ce que montrent les données",
    "The arc": "L'arc",
    "Promises made": "Promesses faites",
    "promises": "promesses",
    "Overall verdict": "Verdict général",
    "{name}'s accountability": "La responsabilité de {name}",
    "kept": "tenues",
    "broken": "brisées",
    "Pattern": "Schéma",
    "Most notable broken promise": "La promesse brisée la plus notable",
    "Most notable kept promise": "La promesse tenue la plus notable",
    "Net energy scores": "Scores d'énergie nets",
    "Energy compatibility": "Compatibilité d'énergie",
    "{name}'s energy": "L'énergie de {name}",
    "Positive energy": "Énergie positive",
    "Draining patterns": "Schémas épuisants",
    "Most energising moment": "Le moment le plus énergisant",
    "Most draining moment": "Le moment le plus épuisant",
    "messages": "messages",
    "Your relationship, in data.": "Votre relation, en données.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Lit votre chat WhatsApp et vous montre ce qui se passe vraiment. Qui est présent. Qui disparaît. Qui porte la conversation.",
    "Skip": "Passer",
    "Start with your chat.": "Commencez par votre chat.",
    "Upload. Analyse. See it clearly.": "Importez. Analysez. Voyez clairement.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Six rapports. Toxicité, langages de l'amour, responsabilité, énergie, croissance et votre chat complet résumé. Résultats en moins d'une minute.",
    "Log out": "Se déconnecter",
    "Feedback Inbox": "Boîte de retours",
    "Large group detected — analysing the top {cap} members out of {count}.": "Grand groupe détecté — analyse des {cap} membres les plus actifs sur {count}.",
  },
  de: {
    "Choose your language": "Wähle deine Sprache",
    "English": "Englisch",
    "Auto-detect": "Automatisch erkennen",
    "Continue": "Weiter",
    "Back": "Zurück",
    "Next": "Weiter",
    "See summary": "Zusammenfassung ansehen",
    "Done": "Fertig",
    "Start over": "Neu starten",
    "Share": "Teilen",
    "What's off about this?": "Was stimmt hier nicht?",
    "Optional note": "Optionale Notiz",
    "Cancel": "Abbrechen",
    "Submit": "Senden",
    "Sending…": "Wird gesendet…",
    "Got it, thank you.": "Verstanden, danke.",
    "Events are mixing": "Ereignisse werden vermischt",
    "Wrong person": "Falsche Person",
    "Didn't happen": "Ist nicht passiert",
    "Tone misread": "Ton falsch gelesen",
    "Overclaiming": "Zu starke Behauptung",
    "Missing context": "Kontext fehlt",
    "Other": "Andere",
    "The Roast": "Der Roast",
    "The Lovely": "Das Süße",
    "The Funny": "Das Lustige",
    "The Stats": "Die Stats",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Toxizitätsbericht",
    "Love Language": "Liebessprache",
    "Growth Report": "Entwicklungsbericht",
    "Accountability": "Verlässlichkeit",
    "Energy Report": "Energiebericht",
    "Choose your report": "Wähle deinen Bericht",
    "Who is this chat with?": "Mit wem ist dieser Chat?",
    "This helps the AI frame the analysis correctly.": "Das hilft der KI, die Analyse richtig einzuordnen.",
    "Partner": "Partner",
    "Dating": "Dating",
    "Ex": "Ex",
    "Related": "Familie",
    "Friend": "Freund",
    "Colleague": "Kollege",
    "Romantic partner or spouse": "Romantischer Partner oder Ehepartner",
    "Seeing each other or early stages": "Ihr trefft euch oder seid in der Anfangsphase",
    "Former romantic partner": "Ehemaliger romantischer Partner",
    "Parent, sibling or relative": "Elternteil, Geschwisterteil oder Verwandte",
    "Close friend or bestie": "Enge Freundin oder bester Freund",
    "Coworker or professional contact": "Arbeitskollege oder beruflicher Kontakt",
    "Someone you know": "Jemand, den du kennst",
    "Reading your messages...": "Deine Nachrichten werden gelesen...",
    "Finding the patterns...": "Muster werden gefunden...",
    "Figuring out who's funny...": "Es wird herausgefunden, wer lustig ist...",
    "Detecting the drama...": "Drama wird erkannt...",
    "Reading between the lines...": "Zwischen den Zeilen lesen...",
    "Almost done...": "Fast fertig...",
    "Upload different file": "Andere Datei hochladen",
    "Upload your chat": "Chat hochladen",
    "Reading your chat…": "Dein Chat wird gelesen…",
    "My Results": "Meine Ergebnisse",
    "Edit": "Bearbeiten",
    "Your chats, unwrapped.": "Deine Chats, aufgedeckt.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Gruppe oder Duo wird automatisch erkannt. Dein Chat wird von KI analysiert und nie gespeichert. Nur die Ergebnisse werden gespeichert.",
    "UI language": "Oberflächensprache",
    "Report language": "Berichtssprache",
    "auto": "auto",
    "changed": "geändert",
    "quips.duo.obsessed": [`"{name}, du solltest vielleicht mal auf deine Bildschirmzeit schauen."`,`"{name} trägt diese Unterhaltung nur mit Tipp-Ausdauer."`,`"Nicht besessen, nur sehr verfügbar. Klar, {name}."`],
    "quips.duo.responseBalanced": [`"Ihr antwortet beide gleich schnell. Keine Geister hier."`,`"Niemand lässt die andere Person warten. Erfrischend."`,`"Ihr seid beide da und antwortet beide. So sieht Balance aus."`],
    "quips.duo.ghost": [`"Klar, {name} war 'beschäftigt'."`,`"{name}: Nachricht gelesen und... irgendwann geantwortet."`,`"{name} behandelt Antworten wie eine begrenzte Ressource."`],
    "quips.duo.lastWord": [`"{name} schickt eine Nachricht. Danach ist Schluss."`,`"Zuletzt gesehen: die unbeantwortete Nachricht von {name}."`,`"{name} hat Talent für das letzte Wort."`],
    "quips.duo.streak100": [`"{streak} Tage. Das ist kein Streak mehr, das ist ein Lebensstil."`,`"Mehr als {streak} Tage am Stück. Was auch immer das ist, es ist echt."`,`"{streak} Tage in Folge. Das ist ernsthafte Konstanz."`],
    "quips.duo.streak30": [`"{streak} Tage ohne Lücke. Das ist selten."`,`"Mehr als einen Monat lang konsequent da sein. Das bedeutet etwas."`,`"Keine Pausen, keine Ausreden. Nur {streak} Tage am Stück."`],
    "quips.duo.streak10": [`"{streak} Tage in Folge. Gar nicht schlecht."`,`"Okay, das ist tatsächlich ziemlich süß."`,`"Irgendetwas lief in diesen {streak} Tagen ziemlich gut."`],
    "quips.duo.streakShort": [`"{streak} Tage. Kurz, aber echt."`,`"Auch ein {streak}-Tage-Streak zählt."`,`"{streak} Tage lang nicht abreißen zu lassen, zählt auch."`],
    "quips.duo.convStarter": [`"Jemand denkt immer zuerst an die andere Person."`,`"{name} ist immer die Person, die zuerst die Stille bricht."`,`"Die erste Nachricht kommt immer wieder von {name}. Das sagt einiges."`],
    "quips.duo.messageLengthSimilar": [`"Fast identische Nachrichtenlängen. Verdächtig ausgeglichen."`,`"Kein Romanautor, kein Kurztexter. Einfach zwei Menschen mit ähnlicher Länge."`,`"Ausgeglichen. Keine Romane, keine Ein-Wort-Antworten."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} behandelt jede Nachricht wie einen Brief an die Nachwelt."`,`"Irgendwo tippt {novelist} immer noch."`,`"{texter} antwortet. {novelist} formuliert aus."`],
    "quips.group.mainCharacter": [`"{name}, das hier ist im Grunde dein persönlicher Blog."`,`"{name} ist gekommen, um zu reden, und macht genau das."`,`"Ohne {name} wäre dieser Chat ein Friedhof."`],
    "quips.group.ghost": [`"{name} ist nur im Geiste hier."`,`"{name} ist der Gruppe beigetreten und sofort verschwunden."`,`"Stiller Beobachter. Komplettes Rätsel. {name}."`],
    "quips.group.lastWord": [`"{name} schickt eine Nachricht. Die Gruppe antwortet nicht. Klassiker."`,`"Nach der Nachricht von {name} wird die Gruppe jedes Mal still."`,`"{name} schickt Nachrichten gern ins Leere."`],
    "quips.group.streak100": [`"{streak} Tage ohne eine einzige Pause. Diese Gruppe ist anders."`,`"Mehr als {streak} Tage am Stück. Das ist echtes Commitment."`,`"Was diese Gruppe am Leben hält, sollte man abfüllen."`],
    "quips.group.streak30": [`"{streak} Tage lang präsent. Das ist eine echte Gruppe."`,`"Kein einziger freier Tag. Diese Gruppe meint es ernst."`,`"Die meisten Gruppen sterben nach zwei Wochen. Diese nicht."`],
    "quips.group.streak10": [`"{streak} Tage in Folge. Die Gruppe war lebendig."`,`"Ihr mögt euch offenbar wirklich. Überraschend."`,`"{streak} Tage in Folge. Mehr als die meisten Gruppen schaffen."`],
    "quips.group.streakShort": [`"{streak} Tage. Klein, aber zählt."`,`"Auch ein {streak}-Tage-Lauf sagt etwas aus."`,`"Selbst {streak} Tage in Folge brauchen Einsatz."`],
    "quips.group.novelist": [`"{name} schreibt, als gäbe es kein Wortlimit."`,`"{name} schickt Nachrichten mit kompletter Handlung."`,`"Wenn es in der Gruppe einen Essay gibt, hat ihn {name} geschrieben."`],
    "msgs": "Nachr.",
    "Red flag {index}": "Warnsignal {index}",
    "This pattern showed up enough to feel worth watching.": "Dieses Muster tauchte oft genug auf, um es im Blick zu behalten.",
    "Evidence": "Beleg",
    "Who's more obsessed?": "Wer ist besessener?",
    "{pct}% of all messages came from {name}.": "{pct}% aller Nachrichten kamen von {name}.",
    "Response times": "Antwortzeiten",
    "Balanced": "Ausgeglichen",
    "{name} avg reply:": "{name} Ø Antwort:",
    "The Ghost Award": "Der Geister-Award",
    "What's really going on": "Was wirklich los ist",
    "The Last Word": "Das Letzte Wort",
    "Sends the last message that nobody replies to — {count} times.": "Schickt die letzte Nachricht, auf die niemand antwortet — {count} Mal.",
    "Sends the last message that nobody replies to.": "Schickt die letzte Nachricht, auf die niemand antwortet.",
    "Your longest streak": "Eure längste Serie",
    "{count} days": "{count} Tage",
    "Texted every single day for {count} days straight.": "Jeden Tag Nachrichten für {count} Tage am Stück.",
    "The Kindest One": "Die Freundlichste Person",
    "The sweetest moment": "Der süßeste Moment",
    "Top 3 most active months": "Die 3 aktivsten Monate",
    "{month} was your month. Something was going on.": "{month} war euer Monat. Da war was los.",
    "Who always reaches out first?": "Wer schreibt immer als Erstes?",
    "Started {pct} of all conversations.": "Hat {pct}% aller Gespräche begonnen.",
    "The Funny One": "Die Lustigste Person",
    "Drops lines like": "Bringt Sprüche wie",
    "Spirit emojis": "Geist-Emojis",
    "These two emojis basically ARE this chat.": "Diese zwei Emojis SIND im Grunde dieser Chat.",
    "Top 10 most used words": "Die 10 meistgenutzten Wörter",
    "Signature phrases": "Charakteristische Phrasen",
    "The phrases that define each of you.": "Die Phrasen, die jeden von euch definieren.",
    "avg chars": "Ø Zeichen",
    "longest message": "längste Nachricht",
    "Media and links": "Medien und Links",
    "Photos & videos": "Fotos & Videos",
    "Voice memos": "Sprachmemos",
    "Links shared": "Geteilte Links",
    "What you actually talk about": "Worüber ihr wirklich redet",
    "Biggest topic": "Hauptthema",
    "Most tense moment": "Der angespannteste Moment",
    "The Drama Report": "Der Drama-Bericht",
    "How they do it": "Wie sie es machen",
    "Chat vibe": "Chat-Stimmung",
    "A chaotic, wholesome connection.": "Eine chaotische, gesunde Verbindung.",
    "Powered by AI — your messages never left your device.": "KI-gestützt — deine Nachrichten haben dein Gerät nie verlassen.",
    "Relationship reading": "Beziehungsanalyse",
    "Observed pattern": "Beobachtetes Muster",
    "Concrete example": "Konkretes Beispiel",
    "Evidence log": "Belegprotokoll",
    "What the chat shows": "Was der Chat zeigt",
    "Toxicity scorecard": "Toxizitätskarte",
    "Why this person scores highest": "Warum diese Person am höchsten punktet",
    "Tension snapshot": "Spannungsmoment",
    "What keeps repeating": "Was sich wiederholt",
    "Main topic": "Hauptthema",
    "Pattern note": "Musternotiz",
    "The strongest pattern is shown above.": "Das stärkste Muster ist oben dargestellt.",
    "Toxicity report": "Toxizitätsbericht",
    "Overall read": "Gesamteinschätzung",
    "Score breakdown": "Punkteaufschlüsselung",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Dieser Modus soll Muster und Beispiele aufzeigen, nicht die Entscheidung für dich treffen.",
    "The Main Character": "Die Hauptfigur",
    "The Ghost": "Der Geist",
    "{count} messages total. Why are they even here?": "{count} Nachrichten insgesamt. Warum sind sie überhaupt hier?",
    "The group was most alive in {month}.": "Die Gruppe war im {month} am aktivsten.",
    "Longest active streak": "Längste aktive Serie",
    "The group kept the chat alive for {count} days straight.": "Die Gruppe hielt den Chat {count} Tage am Stück am Leben.",
    "The Hype Person": "Die Stimmungsmacherin",
    "Started {pct} of all conversations. The engine of this group.": "Hat {pct}% aller Gespräche begonnen. Der Motor dieser Gruppe.",
    "Why {name} is the hype": "Warum {name} die Stimmung macht",
    "Group spirit emoji": "Gruppen-Geist-Emoji",
    "This one emoji basically summarises the entire group energy.": "Dieses eine Emoji fasst die gesamte Gruppenenergie zusammen.",
    "The Novelist": "Der Romanautor",
    "Their longest message was mostly about \"{topic}\".": "Ihre längste Nachricht handelte hauptsächlich von \"{topic}\".",
    "The inside joke": "Der Insider",
    "Most missed member": "Das am meisten vermisste Mitglied",
    "When they go quiet, the group feels it.": "Wenn sie still werden, spürt die Gruppe es.",
    "The group read": "Die Gruppenanalyse",
    "Group dynamic": "Gruppendynamik",
    "Group vibe": "Gruppenatmosphäre",
    "Chaotic. Wholesome. Somehow still going.": "Chaotisch. Gesund. Irgendwie läuft es noch.",
    "Group pattern read": "Gruppenmmusteranalyse",
    "Support and strain": "Unterstützung und Belastung",
    "Who keeps it going": "Wer hält es am Laufen",
    "{name} started {pct} of conversations.": "{name} hat {pct}% der Gespräche begonnen.",
    "The group shares the conversation starts.": "Die Gruppe teilt sich die Gesprächseröffnungen.",
    "Who goes quiet": "Wer wird still",
    "{name} is the least active member in the sampled history.": "{name} ist das inaktivste Mitglied im analysierten Verlauf.",
    "No clear ghost in this sample.": "Kein eindeutiger Geist in dieser Stichprobe.",
    "Chat Health Score": "Chat-Gesundheits-Score",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Von 10 — basierend auf Konfliktmustern, Kommunikationsstil und Gesamtdynamik.",
    "Verdict": "Urteil",
    "Individual health scores": "Individuelle Gesundheits-Scores",
    "Who apologises more": "Wer entschuldigt sich öfter",
    "Red flag moments": "Warnsignal-Momente",
    "Conflict pattern": "Konfliktmuster",
    "How arguments unfold": "Wie Streitigkeiten eskalieren",
    "Power balance": "Machtgleichgewicht",
    "Power dynamic": "Machtdynamik",
    "The verdict": "Das Urteil",
    "Overall chat health score.": "Gesamt-Gesundheits-Score des Chats.",
    "Final read": "Abschließende Einschätzung",
    "Reflects patterns in this sample — not a final judgment.": "Spiegelt Muster in dieser Stichprobe wider — kein endgültiges Urteil.",
    "{name}'s love language": "{name}s Liebessprache",
    "How they show it": "Wie sie es zeigen",
    "The language gap": "Die Sprach-Lücke",
    "Do they speak the same language?": "Sprechen sie dieselbe Sprache?",
    "Most loving moment": "Der liebevollste Moment",
    "The moment": "Der Moment",
    "Love language compatibility": "Kompatibilität der Liebessprachen",
    "Compatibility read": "Kompatibilitätsanalyse",
    "Then vs Now": "Damals vs Heute",
    "Early messages": "Frühe Nachrichten",
    "Recent messages": "Aktuelle Nachrichten",
    "Who changed more": "Wer hat sich mehr verändert",
    "How they changed": "Wie sie sich verändert haben",
    "What changed in the chat": "Was sich im Chat verändert hat",
    "Topics that appeared": "Themen, die auftauchten",
    "Topics that faded": "Themen, die verschwanden",
    "Relationship trajectory": "Beziehungsverlauf",
    "What the data shows": "Was die Daten zeigen",
    "The arc": "Der Bogen",
    "Promises made": "Gemachte Versprechen",
    "promises": "Versprechen",
    "Overall verdict": "Gesamturteil",
    "{name}'s accountability": "{name}s Verlässlichkeit",
    "kept": "gehalten",
    "broken": "gebrochen",
    "Pattern": "Muster",
    "Most notable broken promise": "Das auffälligste gebrochene Versprechen",
    "Most notable kept promise": "Das auffälligste gehaltene Versprechen",
    "Net energy scores": "Netto-Energie-Scores",
    "Energy compatibility": "Energiekompatibilität",
    "{name}'s energy": "{name}s Energie",
    "Positive energy": "Positive Energie",
    "Draining patterns": "Kräftezehrende Muster",
    "Most energising moment": "Der energiereichste Moment",
    "Most draining moment": "Der erschöpfendste Moment",
    "messages": "Nachrichten",
    "Your relationship, in data.": "Deine Beziehung, in Daten.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Liest deinen WhatsApp-Chat und zeigt dir, was wirklich los ist. Wer da ist. Wer ghostet. Wer das Gespräch trägt.",
    "Skip": "Überspringen",
    "Start with your chat.": "Fang mit deinem Chat an.",
    "Upload. Analyse. See it clearly.": "Hochladen. Analysieren. Klar sehen.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Sechs Berichte. Toxizität, Liebessprachen, Verlässlichkeit, Energie, Wachstum und dein vollständiger Chat zusammengefasst. Ergebnisse in weniger als einer Minute.",
    "Log out": "Abmelden",
    "Feedback Inbox": "Feedback-Postfach",
    "Large group detected — analysing the top {cap} members out of {count}.": "Große Gruppe erkannt — die {cap} aktivsten Mitglieder von {count} werden analysiert.",
  },
  it: {
    "Choose your language": "Scegli la tua lingua",
    "English": "Inglese",
    "Auto-detect": "Rilevamento automatico",
    "Continue": "Continua",
    "Back": "Indietro",
    "Next": "Avanti",
    "See summary": "Vedi riepilogo",
    "Done": "Fatto",
    "Start over": "Ricomincia",
    "Share": "Condividi",
    "What's off about this?": "Cosa non torna qui?",
    "Optional note": "Nota facoltativa",
    "Cancel": "Annulla",
    "Submit": "Invia",
    "Sending…": "Invio in corso…",
    "Got it, thank you.": "Ricevuto, grazie.",
    "Events are mixing": "Gli eventi si stanno confondendo",
    "Wrong person": "Persona sbagliata",
    "Didn't happen": "Non è successo",
    "Tone misread": "Tono interpretato male",
    "Overclaiming": "Conclusione esagerata",
    "Missing context": "Manca contesto",
    "Other": "Altro",
    "The Roast": "Il Roast",
    "The Lovely": "Il Tenero",
    "The Funny": "Il Divertente",
    "The Stats": "Le Statistiche",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Report Tossicità",
    "Love Language": "Linguaggio dell'Amore",
    "Growth Report": "Report Evoluzione",
    "Accountability": "Affidabilità",
    "Energy Report": "Report Energia",
    "Choose your report": "Scegli il tuo report",
    "Who is this chat with?": "Con chi è questa chat?",
    "This helps the AI frame the analysis correctly.": "Questo aiuta l'IA a inquadrare correttamente l'analisi.",
    "Partner": "Partner",
    "Dating": "Frequentazione",
    "Ex": "Ex",
    "Related": "Famiglia",
    "Friend": "Amico",
    "Colleague": "Collega",
    "Romantic partner or spouse": "Partner romantico o coniuge",
    "Seeing each other or early stages": "Vi frequentate o siete alle prime fasi",
    "Former romantic partner": "Ex partner romantico",
    "Parent, sibling or relative": "Genitore, fratello, sorella o parente",
    "Close friend or bestie": "Amico stretto o migliore amico",
    "Coworker or professional contact": "Collega o contatto professionale",
    "Someone you know": "Qualcuno che conosci",
    "Reading your messages...": "Sto leggendo i tuoi messaggi...",
    "Finding the patterns...": "Sto trovando gli schemi...",
    "Figuring out who's funny...": "Sto capendo chi è il più divertente...",
    "Detecting the drama...": "Sto rilevando il drama...",
    "Reading between the lines...": "Sto leggendo tra le righe...",
    "Almost done...": "Quasi fatto...",
    "Upload different file": "Carica un file diverso",
    "Upload your chat": "Carica la tua chat",
    "Reading your chat…": "Sto leggendo la tua chat…",
    "My Results": "I miei risultati",
    "Edit": "Modifica",
    "Your chats, unwrapped.": "Le tue chat, svelate.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Gruppo o duo rilevato automaticamente. La tua chat viene analizzata dall'IA e non viene mai archiviata. Vengono salvati solo i risultati.",
    "UI language": "Lingua interfaccia",
    "Report language": "Lingua del report",
    "auto": "auto",
    "changed": "modificato",
    "quips.duo.obsessed": [`"{name}, forse dovresti controllare il tuo tempo schermo."`,`"{name} sta reggendo questa conversazione con pura resistenza da tastiera."`,`"Non è ossessione, è solo troppa disponibilità. Certo, {name}."`],
    "quips.duo.responseBalanced": [`"Rispondete entrambi allo stesso ritmo. Nessun fantasma qui."`,`"Nessuno lascia l'altro in attesa. Rinfrescante."`,`"Entrambi rispondete, entrambi ci siete. Questo è equilibrio."`],
    "quips.duo.ghost": [`"Certo, {name} era 'occupato'."`,`"{name}: ha letto il messaggio e ha risposto... alla fine."`,`"{name} tratta le risposte come una risorsa limitata."`],
    "quips.duo.lastWord": [`"{name} manda un messaggio e la conversazione finisce lì."`,`"Ultima scena: il messaggio di {name}, senza risposta."`,`"{name} ha un talento naturale per l'ultima parola."`],
    "quips.duo.streak100": [`"{streak} giorni. Non è una streak, è uno stile di vita."`,`"Più di {streak} giorni di fila. Qualunque cosa sia, è reale."`,`"{streak} giorni consecutivi. È una costanza seria."`],
    "quips.duo.streak30": [`"{streak} giorni senza buchi. È raro."`,`"Più di un mese di presenza costante. Significa qualcosa."`,`"Niente pause, niente scuse. Solo {streak} giorni di fila."`],
    "quips.duo.streak10": [`"{streak} giorni di fila. Niente male."`,`"Ok, questo è davvero carino."`,`"Qualcosa funzionava chiaramente in quei {streak} giorni."`],
    "quips.duo.streakShort": [`"{streak} giorni. Breve ma vero."`,`"Anche una streak di {streak} giorni conta."`,`"{streak} giorni senza sparire contano comunque."`],
    "quips.duo.convStarter": [`"Qualcuno pensa sempre all'altra persona per primo."`,`"{name} è sempre quello che rompe il silenzio per primo."`,`"Il primo messaggio continua ad arrivare da {name}. Dice molto."`],
    "quips.duo.messageLengthSimilar": [`"Lunghezze quasi identiche. Sospettosamente equilibrato."`,`"Niente romanziere, niente minimalista. Solo due persone che scrivono più o meno uguale."`,`"Equilibrato. Niente poemi, niente risposte da una parola."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} tratta ogni messaggio come una lettera ai posteri."`,`"Da qualche parte {novelist} sta ancora scrivendo."`,`"{texter} risponde. {novelist} sviluppa."`],
    "quips.group.mainCharacter": [`"{name}, questo è praticamente il tuo blog personale."`,`"{name} è venuto qui per parlare, e si vede."`,`"Senza {name}, questa chat sarebbe un cimitero."`],
    "quips.group.ghost": [`"{name} è qui solo spiritualmente."`,`"{name} è entrato nel gruppo ed è sparito subito."`,`"Osservatore silenzioso. Mistero totale. {name}."`],
    "quips.group.lastWord": [`"{name} manda un messaggio. Il gruppo non risponde. Classico."`,`"Dopo il messaggio di {name}, il gruppo si zittisce ogni volta."`,`"{name} ha l'abitudine di mandare messaggi nel vuoto."`],
    "quips.group.streak100": [`"{streak} giorni senza una sola pausa. Questo gruppo è diverso."`,`"Più di {streak} giorni di fila. Qui si parla di impegno."`,`"Quello che tiene vivo questo gruppo andrebbe imbottigliato."`],
    "quips.group.streak30": [`"{streak} giorni di presenza. Questo è un vero gruppo."`,`"Nemmeno un giorno di pausa. Questo gruppo fa sul serio."`,`"La maggior parte dei gruppi muore dopo due settimane. Questo no."`],
    "quips.group.streak10": [`"{streak} giorni di fila. Il gruppo era vivo."`,`"Vi piacete davvero. Sorprendente."`,`"{streak} giorni di fila. Più di quanto facciano la maggior parte dei gruppi."`],
    "quips.group.streakShort": [`"{streak} giorni. Poco, ma conta."`,`"Anche una streak di {streak} giorni significa qualcosa."`,`"Perfino {streak} giorni di fila richiedono impegno."`],
    "quips.group.novelist": [`"{name} scrive come se non esistesse un limite di parole."`,`"{name} manda messaggi con uno sviluppo completo della trama."`,`"Se c'è un saggio nel gruppo, lo ha scritto {name}."`],
    "msgs": "msg",
    "Red flag {index}": "Segnale d'allarme {index}",
    "This pattern showed up enough to feel worth watching.": "Questo schema è apparso abbastanza da meritare attenzione.",
    "Evidence": "Prova",
    "Who's more obsessed?": "Chi è più ossessionato?",
    "{pct}% of all messages came from {name}.": "Il {pct}% di tutti i messaggi è venuto da {name}.",
    "Response times": "Tempi di risposta",
    "Balanced": "Equilibrato",
    "{name} avg reply:": "{name} risp. media:",
    "The Ghost Award": "Il Premio Fantasma",
    "What's really going on": "Cosa sta succedendo davvero",
    "The Last Word": "L'Ultima Parola",
    "Sends the last message that nobody replies to — {count} times.": "Manda l'ultimo messaggio a cui nessuno risponde — {count} volte.",
    "Sends the last message that nobody replies to.": "Manda l'ultimo messaggio a cui nessuno risponde.",
    "Your longest streak": "La tua serie più lunga",
    "{count} days": "{count} giorni",
    "Texted every single day for {count} days straight.": "Messaggi ogni giorno per {count} giorni di fila.",
    "The Kindest One": "La Persona Più Gentile",
    "The sweetest moment": "Il momento più dolce",
    "Top 3 most active months": "I 3 mesi più attivi",
    "{month} was your month. Something was going on.": "{month} era il vostro mese. Stava succedendo qualcosa.",
    "Who always reaches out first?": "Chi scrive sempre per primo?",
    "Started {pct} of all conversations.": "Ha avviato il {pct}% di tutte le conversazioni.",
    "The Funny One": "Il Più Divertente",
    "Drops lines like": "Lascia cadere frasi come",
    "Spirit emojis": "Emoji spirito",
    "These two emojis basically ARE this chat.": "Queste due emoji SONO fondamentalmente questa chat.",
    "Top 10 most used words": "Le 10 parole più usate",
    "Signature phrases": "Frasi caratteristiche",
    "The phrases that define each of you.": "Le frasi che definiscono ognuno di voi.",
    "avg chars": "car. medi",
    "longest message": "messaggio più lungo",
    "Media and links": "Media e link",
    "Photos & videos": "Foto e video",
    "Voice memos": "Note vocali",
    "Links shared": "Link condivisi",
    "What you actually talk about": "Di cosa parlate davvero",
    "Biggest topic": "Argomento principale",
    "Most tense moment": "Il momento più teso",
    "The Drama Report": "Il Rapporto Drama",
    "How they do it": "Come lo fanno",
    "Chat vibe": "Atmosfera della chat",
    "A chaotic, wholesome connection.": "Un legame caotico ma sano.",
    "Powered by AI — your messages never left your device.": "Alimentato dall'IA — i tuoi messaggi non hanno mai lasciato il tuo dispositivo.",
    "Relationship reading": "Lettura della relazione",
    "Observed pattern": "Schema osservato",
    "Concrete example": "Esempio concreto",
    "Evidence log": "Registro delle prove",
    "What the chat shows": "Cosa mostra la chat",
    "Toxicity scorecard": "Scheda della tossicità",
    "Why this person scores highest": "Perché questa persona ha il punteggio più alto",
    "Tension snapshot": "Istantanea della tensione",
    "What keeps repeating": "Cosa continua a ripetersi",
    "Main topic": "Argomento principale",
    "Pattern note": "Nota sullo schema",
    "The strongest pattern is shown above.": "Lo schema più forte è mostrato sopra.",
    "Toxicity report": "Rapporto sulla tossicità",
    "Overall read": "Lettura generale",
    "Score breakdown": "Dettaglio del punteggio",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Questa modalità serve a evidenziare schemi ed esempi, non a decidere per te.",
    "The Main Character": "Il Personaggio Principale",
    "The Ghost": "Il Fantasma",
    "{count} messages total. Why are they even here?": "{count} messaggi in totale. Perché ci sono qui?",
    "The group was most alive in {month}.": "Il gruppo era più attivo a {month}.",
    "Longest active streak": "Serie attiva più lunga",
    "The group kept the chat alive for {count} days straight.": "Il gruppo ha tenuto la chat viva per {count} giorni di fila.",
    "The Hype Person": "L'Animatore del Gruppo",
    "Started {pct} of all conversations. The engine of this group.": "Ha avviato il {pct}% di tutte le conversazioni. Il motore del gruppo.",
    "Why {name} is the hype": "Perché {name} anima il gruppo",
    "Group spirit emoji": "Emoji spirito del gruppo",
    "This one emoji basically summarises the entire group energy.": "Questa emoji riassume praticamente tutta l'energia del gruppo.",
    "The Novelist": "Il Romanziere",
    "Their longest message was mostly about \"{topic}\".": "Il loro messaggio più lungo riguardava principalmente \"{topic}\".",
    "The inside joke": "La battuta interna",
    "Most missed member": "Il membro più rimpianto",
    "When they go quiet, the group feels it.": "Quando tacciono, il gruppo lo sente.",
    "The group read": "La lettura del gruppo",
    "Group dynamic": "Dinamica del gruppo",
    "Group vibe": "Atmosfera del gruppo",
    "Chaotic. Wholesome. Somehow still going.": "Caotico. Sano. In qualche modo ancora attivo.",
    "Group pattern read": "Lettura dello schema del gruppo",
    "Support and strain": "Supporto e tensione",
    "Who keeps it going": "Chi lo mantiene vivo",
    "{name} started {pct} of conversations.": "{name} ha avviato il {pct}% delle conversazioni.",
    "The group shares the conversation starts.": "Il gruppo condivide i punti di partenza delle conversazioni.",
    "Who goes quiet": "Chi si fa silenzioso",
    "{name} is the least active member in the sampled history.": "{name} è il membro meno attivo nella cronologia analizzata.",
    "No clear ghost in this sample.": "Nessun fantasma evidente in questo campione.",
    "Chat Health Score": "Punteggio di Salute della Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Su 10 — basato su schemi di conflitto, stile di comunicazione e dinamica generale.",
    "Verdict": "Verdetto",
    "Individual health scores": "Punteggi di salute individuali",
    "Who apologises more": "Chi si scusa di più",
    "Red flag moments": "Momenti di allarme",
    "Conflict pattern": "Schema di conflitto",
    "How arguments unfold": "Come si sviluppano le discussioni",
    "Power balance": "Equilibrio del potere",
    "Power dynamic": "Dinamica del potere",
    "The verdict": "Il verdetto",
    "Overall chat health score.": "Punteggio generale di salute della chat.",
    "Final read": "Lettura finale",
    "Reflects patterns in this sample — not a final judgment.": "Riflette schemi in questo campione — non è un giudizio definitivo.",
    "{name}'s love language": "Il linguaggio dell'amore di {name}",
    "How they show it": "Come lo mostrano",
    "The language gap": "Il divario di linguaggio",
    "Do they speak the same language?": "Parlano la stessa lingua?",
    "Most loving moment": "Il momento più amorevole",
    "The moment": "Il momento",
    "Love language compatibility": "Compatibilità del linguaggio dell'amore",
    "Compatibility read": "Lettura della compatibilità",
    "Then vs Now": "Prima vs Ora",
    "Early messages": "Messaggi iniziali",
    "Recent messages": "Messaggi recenti",
    "Who changed more": "Chi è cambiato di più",
    "How they changed": "Come sono cambiati",
    "What changed in the chat": "Cosa è cambiato nella chat",
    "Topics that appeared": "Argomenti apparsi",
    "Topics that faded": "Argomenti scomparsi",
    "Relationship trajectory": "Traiettoria della relazione",
    "What the data shows": "Cosa mostrano i dati",
    "The arc": "L'arco",
    "Promises made": "Promesse fatte",
    "promises": "promesse",
    "Overall verdict": "Verdetto generale",
    "{name}'s accountability": "L'affidabilità di {name}",
    "kept": "mantenute",
    "broken": "infrante",
    "Pattern": "Schema",
    "Most notable broken promise": "La promessa infranta più significativa",
    "Most notable kept promise": "La promessa mantenuta più significativa",
    "Net energy scores": "Punteggi netti di energia",
    "Energy compatibility": "Compatibilità energetica",
    "{name}'s energy": "L'energia di {name}",
    "Positive energy": "Energia positiva",
    "Draining patterns": "Schemi logoranti",
    "Most energising moment": "Il momento più energizzante",
    "Most draining moment": "Il momento più logorante",
    "messages": "messaggi",
    "Your relationship, in data.": "La tua relazione, in dati.",
    "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Legge la tua chat WhatsApp e ti mostra cosa sta succedendo davvero. Chi è presente. Chi sparisce. Chi porta avanti la conversazione.",
    "Skip": "Salta",
    "Start with your chat.": "Inizia con la tua chat.",
    "Upload. Analyse. See it clearly.": "Carica. Analizza. Vedi chiaramente.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Sei report. Tossicità, linguaggi dell'amore, affidabilità, energia, crescita e la tua chat completa riassunta. Risultati in meno di un minuto.",
    "Log out": "Esci",
    "Feedback Inbox": "Casella di feedback",
    "Large group detected — analysing the top {cap} members out of {count}.": "Gruppo grande rilevato — analisi dei {cap} membri più attivi su {count}.",
  },
};

const SUPPORTED_UI_LANGS = new Set(Object.keys(LANG_META));
function normalizeUiLangPref(value) {
  return value === "auto" ? "auto" : "english";
}
function normalizeUiLangCode(value) {
  const code = String(value || "en").trim().toLowerCase();
  return SUPPORTED_UI_LANGS.has(code) ? code : "en";
}
function resolveUiLang(uiLangPref, detectedCode) {
  return normalizeUiLangPref(uiLangPref) === "auto"
    ? normalizeUiLangCode(detectedCode)
    : "en";
}
function formatUITranslation(value, vars = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}
function translateUI(lang, key, vars = {}) {
  const code = normalizeUiLangCode(lang);
  const raw = UI_TRANSLATIONS[code]?.[key] ?? UI_TRANSLATIONS.en?.[key] ?? key;
  if (Array.isArray(raw)) return raw.map(item => formatUITranslation(item, vars));
  return formatUITranslation(raw, vars);
}

const CONTROL_TRANSLATIONS = {
  tr: {
    "Words of Affirmation": "Onay sözleri",
    "Acts of Service": "Hizmet davranışları",
    "Receiving Gifts": "Hediye alma",
    "Quality Time": "Kaliteli zaman",
    "Physical Touch": "Fiziksel temas",
    "Mixed": "Karışık",
    "net positive": "net pozitif",
    "mixed": "karışık",
    "net draining": "net yorucu",
    "deeper": "daha derin",
    "shallower": "daha yüzeysel",
    "about the same": "hemen hemen aynı",
    "closer": "yakınlaşan",
    "drifting": "uzaklaşan",
    "stable": "stabil",
    "Balanced": "Dengeli",
    "Shared": "Paylaşılan",
    "Tie": "Berabere",
    "None clearly identified": "Belirgin biri yok",
    "Both equally": "İkisi de eşit",
  },
  es: {
    "Words of Affirmation": "Palabras de afirmacion",
    "Acts of Service": "Actos de servicio",
    "Receiving Gifts": "Recibir regalos",
    "Quality Time": "Tiempo de calidad",
    "Physical Touch": "Contacto fisico",
    "Mixed": "Mixto",
    "net positive": "neto positivo",
    "mixed": "mixto",
    "net draining": "neto agotador",
    "deeper": "mas profundo",
    "shallower": "mas superficial",
    "about the same": "casi igual",
    "closer": "mas cerca",
    "drifting": "alejandose",
    "stable": "estable",
    "Balanced": "Equilibrado",
    "Shared": "Compartido",
    "Tie": "Empate",
    "None clearly identified": "No se identifica claramente",
    "Both equally": "Ambos por igual",
  },
  pt: {
    "Words of Affirmation": "Palavras de afirmacao",
    "Acts of Service": "Atos de servico",
    "Receiving Gifts": "Receber presentes",
    "Quality Time": "Tempo de qualidade",
    "Physical Touch": "Toque fisico",
    "Mixed": "Misto",
    "net positive": "net positivo",
    "mixed": "misto",
    "net draining": "net desgastante",
    "deeper": "mais profundo",
    "shallower": "mais superficial",
    "about the same": "quase igual",
    "closer": "mais proximos",
    "drifting": "se afastando",
    "stable": "estavel",
    "Balanced": "Equilibrado",
    "Shared": "Compartilhado",
    "Tie": "Empate",
    "None clearly identified": "Ninguem claramente identificado",
    "Both equally": "Ambos igualmente",
  },
  ar: {
    "Words of Affirmation": "كلمات التقدير",
    "Acts of Service": "افعال الخدمة",
    "Receiving Gifts": "تلقي الهدايا",
    "Quality Time": "وقت نوعي",
    "Physical Touch": "اللمس الجسدي",
    "Mixed": "مختلط",
    "net positive": "ايجابي صافي",
    "mixed": "مختلط",
    "net draining": "مستنزف صافي",
    "deeper": "اعمق",
    "shallower": "اكثر سطحية",
    "about the same": "تقريبا نفسه",
    "closer": "اكثر قربا",
    "drifting": "يبتعد",
    "stable": "مستقر",
    "Balanced": "متوازن",
    "Shared": "مشترك",
    "Tie": "تعادل",
    "None clearly identified": "لا يوجد شخص محدد بوضوح",
    "Both equally": "كلاهما بالتساوي",
  },
  fr: {
    "Words of Affirmation": "Paroles valorisantes",
    "Acts of Service": "Actes de service",
    "Receiving Gifts": "Recevoir des cadeaux",
    "Quality Time": "Temps de qualite",
    "Physical Touch": "Contact physique",
    "Mixed": "Mixte",
    "net positive": "net positif",
    "mixed": "mixte",
    "net draining": "net epuisant",
    "deeper": "plus profond",
    "shallower": "plus superficiel",
    "about the same": "a peu pres pareil",
    "closer": "plus proches",
    "drifting": "s'eloignent",
    "stable": "stable",
    "Balanced": "Equilibre",
    "Shared": "Partage",
    "Tie": "Egalite",
    "None clearly identified": "Aucune personne clairement identifiee",
    "Both equally": "Les deux egalement",
  },
  de: {
    "Words of Affirmation": "Worte der Bestatigung",
    "Acts of Service": "Hilfsbereite Taten",
    "Receiving Gifts": "Geschenke bekommen",
    "Quality Time": "Gemeinsame Zeit",
    "Physical Touch": "Korperliche Beruhrung",
    "Mixed": "Gemischt",
    "net positive": "klar positiv",
    "mixed": "gemischt",
    "net draining": "klar belastend",
    "deeper": "tiefer",
    "shallower": "oberflachlicher",
    "about the same": "ungefahr gleich",
    "closer": "naher",
    "drifting": "driften auseinander",
    "stable": "stabil",
    "Balanced": "Ausgeglichen",
    "Shared": "Geteilt",
    "Tie": "Unentschieden",
    "None clearly identified": "Niemand klar erkennbar",
    "Both equally": "Beide gleichermassen",
  },
  it: {
    "Words of Affirmation": "Parole di conferma",
    "Acts of Service": "Atti di servizio",
    "Receiving Gifts": "Ricevere regali",
    "Quality Time": "Tempo di qualita",
    "Physical Touch": "Contatto fisico",
    "Mixed": "Misto",
    "net positive": "netto positivo",
    "mixed": "misto",
    "net draining": "netto drenante",
    "deeper": "piu profondo",
    "shallower": "piu superficiale",
    "about the same": "piu o meno uguale",
    "closer": "piu vicini",
    "drifting": "si stanno allontanando",
    "stable": "stabile",
    "Balanced": "Equilibrato",
    "Shared": "Condiviso",
    "Tie": "Parita",
    "None clearly identified": "Nessuno chiaramente identificato",
    "Both equally": "Entrambi allo stesso modo",
  },
};

function translateControlValue(lang, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const code = normalizeUiLangCode(lang);
  return CONTROL_TRANSLATIONS[code]?.[text] || text;
}

function useControlT() {
  const { uiLang } = useUILanguage();
  return (value) => translateControlValue(uiLang, value);
}

// High-frequency stopwords that are strongly characteristic of each language.
// Overlap with other languages is intentional — scoring across all languages
// simultaneously lets the distribution decide rather than strict rules.
const LANG_WORDS = {
  en: new Set(["the","and","you","that","this","with","have","from","they","just","okay","yeah","dont","cant","what","your","for","but","not","its","was","are","like","know","sure","well","going","hey","haha","will","when","yes","really","need","want","come","time","good","got","been","about","get"]),
  tr: new Set(["bir","bu","ne","ben","sen","var","yok","ama","çok","nasıl","tamam","şimdi","evet","hayır","iyi","güzel","dedi","geldi","gidiyor","bilmiyorum","oldu","olur","neden","abi","canım","tabi","hani","yani","artık","bak","dur","gel","git","şey","bence","aslında","belki","seni","beni","çünkü"]),
  es: new Set(["que","los","las","con","una","del","para","por","pero","este","esto","están","tengo","gracias","hola","estoy","bien","también","cuando","porque","después","ahora","todo","muy","más","hay","así","hacer","voy","estar","quiero","puedo","sabe","siempre","nada","algo","claro","bueno","pues"]),
  pt: new Set(["que","com","uma","para","isso","você","está","tudo","então","também","quando","porque","minha","nossa","agora","aqui","depois","quero","posso","acho","fazer","vou","hoje","gente","cara","obrigado","obrigada","beleza","saudade","não","sim","né","bom","tá","oi","boa","legal","kkkk"]),
  fr: new Set(["les","des","une","est","pas","plus","avec","pour","dans","mais","bien","merci","voilà","aussi","quoi","moi","toi","mon","ton","son","sur","oui","non","très","tout","même","comme","quand","parce","alors","après","encore","rien","ça","je","tu","bonsoir","bonjour","salut","super"]),
  de: new Set(["und","die","der","das","ich","nicht","ist","mit","für","eine","bitte","danke","schon","auch","habe","nein","ja","gut","sehr","wenn","aber","noch","nur","mal","wie","was","wir","du","es","so","dann","doch","jetzt","muss","kann","hier","also","okay","klar","alles","hallo"]),
  it: new Set(["che","non","con","una","per","del","sono","hai","grazie","ciao","cosa","bene","anche","però","tutto","adesso","quando","perché","molto","come","così","dopo","poi","ancora","più","mio","tuo","suo","dove","vuoi","fare","questo","bella","bello","dai","sì","no","vero","comunque"]),
};

// Arabic block — unambiguous; ı/ğ/ş/İ are Turkish-only among supported languages
const ARABIC_RE        = /[\u0600-\u06FF]/;
const TURKISH_CHAR_RE  = /[ğışİ]/;

const LANG_DETECT_SAMPLE  = 250;  // max messages to inspect
const LANG_CONFIDENCE_MIN = 0.30; // fallback to English below this share

// Returns { code: string, label: string, confidence: number (0–1) }
function detectLanguage(messages) {
  // Evenly-spaced sample to cover the whole chat timeline
  const n      = messages.length;
  const step   = n > LANG_DETECT_SAMPLE ? Math.floor(n / LANG_DETECT_SAMPLE) : 1;
  const sample = [];
  for (let i = 0; i < n && sample.length < LANG_DETECT_SAMPLE; i += step) sample.push(messages[i]);

  const scores = { en: 0, tr: 0, es: 0, pt: 0, ar: 0, fr: 0, de: 0, it: 0 };

  for (const { body } of sample) {
    if (!body || /^<(Voice|Media) omitted>$/i.test(body) || body.startsWith("http")) continue;

    // Arabic block: strong signal — skip further scoring for this message
    if (ARABIC_RE.test(body)) { scores.ar += 6; continue; }

    // Turkish-specific characters not found in other listed languages
    if (TURKISH_CHAR_RE.test(body)) scores.tr += 3;

    const words = body.toLowerCase().replace(/[^\p{L}\s]/gu, "").split(/\s+/);
    for (const w of words) {
      if (w.length < 2) continue;
      for (const [code, wordSet] of Object.entries(LANG_WORDS)) {
        if (wordSet.has(w)) scores[code] += 1;
      }
    }
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topCode, topScore] = entries[0];
  const total = Object.values(scores).reduce((s, v) => s + v, 0);

  if (total === 0 || topScore === 0) return { code: "en", label: "English", confidence: 0 };

  const confidence = topScore / total;
  if (confidence < LANG_CONFIDENCE_MIN) return { code: "en", label: "English", confidence };
  return { code: topCode, label: LANG_META[topCode] ?? "English", confidence };
}

// ─────────────────────────────────────────────────────────────────
// LARGE-GROUP CAP
// ─────────────────────────────────────────────────────────────────
const GROUP_PARTICIPANT_THRESHOLD = 20; // above this, cap is applied
const GROUP_PARTICIPANT_CAP       = 10; // keep this many top senders

function capLargeGroup(messages) {
  const countByName = {};
  messages.forEach(m => { countByName[m.name] = (countByName[m.name] || 0) + 1; });
  const allNames = Object.keys(countByName);
  if (allNames.length <= GROUP_PARTICIPANT_THRESHOLD) {
    return { messages, cappedGroup: false, originalParticipantCount: allNames.length };
  }
  const topNames = new Set(
    Object.entries(countByName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, GROUP_PARTICIPANT_CAP)
      .map(([n]) => n)
  );
  return {
    messages: messages.filter(m => topNames.has(m.name)),
    cappedGroup: true,
    originalParticipantCount: allNames.length,
  };
}
// ─────────────────────────────────────────────────────────────────
// LOCAL MATH
// ─────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([

  // ── English ──
  "i","me","my","myself","we","our","ours","ourselves","you","your","yours",
  "yourself","he","him","his","she","her","hers","they","them","their","theirs",
  "it","its","what","which","who","whom","this","that","these","those",
  "am","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","shall","should","may","might","must","can","could",
  "a","an","the","and","but","or","nor","so","yet","either","neither",
  "not","nor","as","at","by","for","in","of","on","to","up","with","from",
  "into","through","during","such","than","too","very","just","because",
  "if","while","although","though","since","about","get","got","im",

  // ── Turkish ──
  "bir","bu","şu","o","ve","ile","de","da","ki","mi","mı","mu","mü",
  "ben","sen","biz","siz","onlar","beni","seni","onu","bize","size","onlara",
  "için","ama","fakat","lakin","ya","veya","gibi","kadar","daha","en","çok",
  "az","ne","nasıl","neden","çünkü","eğer","ise","değil","var","yok","olan",
  "oldu","olacak","oluyor","olmuş","işte","şey","diye","bile","hem","hiç","artık",

  // ── Spanish ──
  "yo","tú","él","ella","nosotros","ellos","ellas","me","te","se",
  "lo","la","los","las","le","les","un","una","el","y","o","pero",
  "que","si","en","de","a","con","por","para","sin","sobre","entre",
  "como","muy","también","tampoco",

  // ── Portuguese ──
  "eu","tu","ele","ela","nós","eles","elas","me","te","se","um","uma",
  "o","a","os","as","e","ou","mas","que","não","em","de","com","por",
  "para","sem","sobre","entre","como","muito","também","já",

  // ── French ──
  "je","tu","il","elle","nous","vous","ils","elles","me","te","se",
  "le","la","les","lui","leur","un","une","des","du","de","et","ou",
  "mais","que","qui","dont","si","ne","pas","plus","très","aussi",
  "encore","toujours","jamais","comment","pourquoi","tout","rien",

  // ── German ──
  "ich","du","er","sie","es","wir","ihr","mich","dich","sich","uns",
  "euch","mir","dir","ihm","ihnen","ein","eine","einen","einem","einer",
  "eines","der","die","das","den","dem","des","und","oder","aber","weil",
  "dass","wenn","ob","nicht","kein","keine","auch","noch","schon","nur",
  "so","sehr","eigentlich","irgendwie",

  // ── Italian ──
  "io","tu","lui","lei","noi","voi","loro","mi","ti","si","ci","vi",
  "lo","la","li","le","gli","un","una","il","i","e","o","ma","perché",
  "che","se","non","in","di","a","con","per","su","tra","fra","come",
  "più","molto","anche","ancora","sempre","mai","tutto","niente",

  // ── Arabic ──
  "أنا","أنت","هو","هي","نحن","أنتم","هم","في","من","إلى","على","مع",
  "عن","هذا","هذه","ذلك","تلك","التي","الذي","و","أو","لكن","لأن","إذا",
  "لا","ما","كيف","لماذا","متى","أين","كل","بعض","هنا","هناك",

  // ── WhatsApp UI — English ──
  "image omitted","video omitted","audio omitted","voice omitted",
  "sticker omitted","gif omitted","document omitted","contact omitted",
  "media omitted","photo omitted","file omitted","location omitted",
  "poll omitted","this message was deleted","you deleted this message",
  "missed voice call","missed video call","message deleted",
  "edited","forwarded","forwarded many times",
  "call","voice","omitted","missed","missed call","voice call",
  "voice message","call omitted","missed voice","missed video","waiting","ringing",

  // ── WhatsApp UI — Turkish ──
  "görüntü silindi","video silindi","ses silindi","belge silindi",
  "konum silindi","çıkartma","bu mesaj silindi","mesaj silindi",
  "cevapsız sesli arama","cevapsız görüntülü arama","düzenlendi","iletildi",
  "arama","sesli","atlandı","cevapsız","sesli arama","görüntülü arama",
  "sesli mesaj","arama atlandı","cevapsız arama","bekliyor","çalıyor",
  "sesli not","görüntülü not",

  // ── WhatsApp UI — Spanish ──
  "imagen omitida","video omitido","audio omitido","documento omitido",
  "ubicación omitida","este mensaje fue eliminado","editado","reenviado",
  "llamada","voz","omitido","perdida","llamada perdida","llamada de voz",
  "mensaje de voz","nota de voz","llamada omitida","esperando","sonando",

  // ── WhatsApp UI — Portuguese ──
  "imagem ocultada","vídeo ocultado","áudio ocultado","documento ocultado",
  "esta mensagem foi apagada","editada","encaminhada",
  "chamada","voz","omitido","perdida","chamada perdida","chamada de voz",
  "mensagem de voz","nota de voz","chamada omitida","aguardando","chamando",

  // ── WhatsApp UI — French ──
  "image omise","vidéo omise","audio omis","document omis",
  "ce message a été supprimé","modifié","transféré",
  "appel","voix","omis","manqué","appel manqué","appel vocal",
  "message vocal","note vocale","appel omis","en attente","sonnerie",

  // ── WhatsApp UI — German ──
  "bild weggelassen","video weggelassen","audio weggelassen","dokument weggelassen",
  "diese nachricht wurde gelöscht","bearbeitet","weitergeleitet",
  "anruf","sprache","weggelassen","verpasst","verpasster anruf","sprachanruf",
  "sprachnachricht","sprachnotiz","anruf weggelassen","wartend","klingelt",

  // ── WhatsApp UI — Italian ──
  "immagine omessa","video omesso","audio omesso","documento omesso",
  "questo messaggio è stato eliminato","modificato","inoltrato",
  "chiamata","voce","omessa","persa","chiamata persa","chiamata vocale",
  "messaggio vocale","nota vocale","chiamata omessa","in attesa","squillando",

  // ── WhatsApp UI — Arabic ──
  "تم حذف هذه الرسالة","صورة محذوفة","فيديو محذوف","صوت محذوف",
  "مستند محذوف","تم التعديل","تمت إعادة التوجيه",
  "مكالمة","صوت","محذوف","فائتة","مكالمة فائتة","مكالمة صوتية",
  "رسالة صوتية","مكالمة محذوفة","في الانتظار","يرن",
]);

const TOKEN_STOP_WORDS = new Set(
  Array.from(STOP_WORDS).flatMap(term =>
    String(term || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  )
);

const WA_NOISE_WORDS = new Set([
  "image","images","video","videos","audio","voice","sticker","gif","document","documents",
  "contact","contacts","media","photo","photos","file","files","location","poll","call","calls",
  "missed","omitted","deleted","message","messages","edited","forwarded","attached",
]);

const TOKEN_WA_NOISE_WORDS = new Set(
  Array.from(WA_NOISE_WORDS).flatMap(term =>
    String(term || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  )
);

const ROMANCE_RE = /\b(love you|luv you|miss you|my love|baby|babe|bb|darling|good night love|good morning love|kiss you|date night|come over|sleep well|xoxo|sevgilim|askim|aşkım|canim|canım|ozledim|özledim|tatlim|tatlım|bebegim|bebeğim)\b/i;
const FRIEND_RE = /\b(bestie|bro|broski|dude|girl|sis|mate|homie|kanka|knk|abi|abla)\b/i;
const WORK_RE = /\b(meeting|deadline|project|client|invoice|brief|office|shift|deck|review this|sunum|mesai|müşteri|musteri|patron|toplantı|toplanti)\b/i;
const DATE_RE = /\b(date|dinner tonight|movie night|see you tonight|come over|valentine|anniversary)\b/i;
const FLIRTY_EMOJI_RE = /(❤️|❤|💕|💖|💗|💘|😍|🥰|😘|💋)/;

const CONTROL_RE = /\b(where are you|who are you with|why are you online|why were you online|why didn't you reply|why dont you reply|why didn't you answer|why didnt you answer|answer me|pick up|call me now|send me your location|share your location|send your location|reply now|reply to me|neredesin|nerde kaldın|kimlesin|kimleydin|neden cevap vermedin|niye cevap vermedin|cevap ver|cvp ver|aç telefonu|telefonu aç|konum at|konumunu at|konum paylaş|konumunu paylaş)\b/i;
const AGGRO_RE = /\b(stupid|idiot|shut up|hate you|leave me alone|you're crazy|you are crazy|disgusting|pathetic|annoying|i'm sick of this|i am sick of this|salak|gerizekal[ıi]|aptal|mal|siktir|siktir git|defol|yeter|bıktım|biktim|nefret ediyorum|manyak|saçma|sacma)\b/i;
const BREAKUP_RE = /\b(it'?s over|we'?re done|i'?m done|im done|done with you|break up|breakup|goodbye forever|don't text me|dont text me|blocked you|bitti|bitsin|ayrıl|ayrilelim|ayrılalım|beni arama|yazma bana|engelledim|sildim seni)\b/i;
const APOLOGY_RE = /\b(sorry|i'm sorry|i am sorry|my fault|forgive me|özür dilerim|ozur dilerim|affet|hata bendeydi|haklısın|haklisin)\b/i;
const LAUGH_RE = new RegExp(
  [
    // Standard laugh patterns
    "\\b(ha(ha)+|haha+|hahaha+|lol+|lmao+|lmfao+|hehe+|heh|hah|ahaha+|ahahah+|ahahha+|heheheh+)\\b",
    // Death-laugh expressions
    "\\b(im dead|i'm dead|dying|dead|ded|i'm deceased)\\b",
    // Turkish/universal random keyboard mash (4+ chars of consonant clusters)
    "\\b([sşkdgjfhbnmzxcvwq]{4,})\\b",
    // Emojis
    "[😂💀🤣]",
  ].join("|"),
  "i"
);

const RELATION_SIGNALS = [
  {
    key: "romantic",
    re: /\b(babe|baby|bb|darling|my love|love you|luv you|sweetheart|honey|dear|sevgilim|aşkım|askım|canım|canim|tatlım|tatlim|bebeğim|bebegim|mi amor|mi vida|cariño|carino|te quiero|te amo|meu amor|minha vida|querido|querida|habibi|habibti|حبيبي|حبيبتي|mon amour|ma chérie|ma cherie|mon chéri|mon cheri|liebling|schatzi|mein schatz|amore mio|tesoro)\b/i,
  },
  {
    key: "mother",
    re: /\b(mom|mum|mama|mother|anne|annem|anneciğim|anneciim|mamá|mama|mãe|mamaí|أمي|ummi|maman|mère|mere|mama|mutter|mutti|mamma|madre)\b/i,
  },
  {
    key: "father",
    re: /\b(dad|dada|daddy|father|baba|babam|babaciğim|papá|papa|pai|أبي|abi|papa|père|pere|papa|vater|vati|papà|padre)\b/i,
  },
  {
    key: "sibling",
    re: /\b(sis|bro|brother|sister|kardeş|kardesim|ablam|abla|ağabey|agabey|hermano|hermana|irmão|irmã|أخي|أختي|frère|frere|sœur|soeur|bruder|schwester|fratello|sorella)\b/i,
  },
  {
    key: "cousin",
    re: /\b(cousin|kuzen|kuzenim|primo|prima|cousin|عمي|ابن عمي|cousin|cousin|cousine|vetter|kusine|cugino|cugina)\b/i,
  },
  {
    key: "aunt",
    re: /\b(aunt|auntie|teyze|hala|tía|tia|خالتي|عمتي|tante|tante|tante|zia)\b/i,
  },
  {
    key: "uncle",
    re: /\b(uncle|amca|dayı|dayi|tío|tio|عمي|خالي|oncle|onkel|zio)\b/i,
  },
  {
    key: "friend",
    re: /\b(bestie|dude|mate|homie|kanka|knk|amigo|amiga|colega|صاحبي|صديقي|pote|parceiro|ami|amie|copain|copine|Kumpel|alter|amico|amica)\b/i,
  },
];

function detectRelationship(messages) {
  const counts = {};
  const sample = messages.slice(0, 800);
  for (const msg of sample) {
    if (!msg.body || /^<(Voice|Media) omitted>$/.test(msg.body)) continue;
    for (const { key, re } of RELATION_SIGNALS) {
      if (re.test(msg.body)) {
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  }
  if (!Object.keys(counts).length) return null;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const confidence = top[1] >= 4 ? "high" : top[1] >= 2 ? "medium" : "low";
  if (confidence === "low") return null;
  return { detected: top[0], confidence, counts };
}

const DUO_CONTENT_SCREENS = 20;
const GROUP_CONTENT_SCREENS = 19;
const LOADING_STEPS = ["Reading your messages...","Finding the patterns...","Figuring out who's funny...","Detecting the drama...","Reading between the lines...","Almost done..."];
const MODE_META = {
  casual: {
    label: "Casual Analysis",
    short: "Casual",
    blurb: "Funny, sweet, and stats-heavy chat wrap.",
  },
  redflags: {
    label: "Red Flags Spotter",
    short: "Red Flags",
    blurb: "Relationship status, toxicity, and warning signs.",
  },
};
const DUO_CASUAL_SCREENS = 17;
const DUO_REDFLAG_SCREENS = 7;
const GROUP_CASUAL_SCREENS = 17;
const GROUP_REDFLAG_SCREENS = 6;

function isPassiveAggressive(body) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.length <= 20 && /^(fine|whatever|ok then|okay then|sure|k|kk|nvm|never mind|forget it|sen bilirsin|tamam ya|boşver|bosver|neyse|aynen|bravo|peki)$/.test(trimmed);
}

function capsBurst(body) {
  const upper = body.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  return upper.length >= 5 && /[!?]{2,}/.test(body);
}

function normalizeRedFlags(flags) {
  if (!Array.isArray(flags)) return [];
  return flags.map((flag, i) => {
    if (typeof flag === "string") {
      return { title: `Red flag ${i + 1}`, detail: flag };
    }
    if (flag && typeof flag === "object") {
      const title = String(flag.title || flag.label || flag.flag || `Red flag ${i + 1}`).trim();
      const detail = String(flag.detail || flag.reason || flag.description || "").trim();
      const evidence = String(flag.evidence || flag.example || "").trim();
      if (!title && !detail) return null;
      return { title: title || `Red flag ${i + 1}`, detail, evidence };
    }
    return null;
  }).filter(Boolean).slice(0, 3);
}

function normalizeTimeline(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (typeof item === "string") {
      return { date: `Point ${i + 1}`, title: item, detail: "" };
    }
    if (!item || typeof item !== "object") return null;
    return {
      date: String(item.date || item.when || `Point ${i + 1}`).trim(),
      title: String(item.title || item.label || item.observation || `Point ${i + 1}`).trim(),
      detail: String(item.detail || item.description || item.quote || "").trim(),
    };
  }).filter(Boolean).slice(0, 5);
}

function formatEvidenceDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function cleanQuote(body, max = 72) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function formatGap(gapMin) {
  if (gapMin < 60) return `${Math.round(gapMin)}m`;
  const hours = Math.floor(gapMin / 60);
  const mins = Math.round(gapMin % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function spotDynamics({ messages, namesAll, namesSorted, msgCounts, starterCount, isGroup }) {
  const tracked = new Set(namesAll);
  const stats = {};
  namesAll.forEach(name => {
    stats[name] = {
      control: 0,
      aggression: 0,
      breakup: 0,
      passive: 0,
      apology: 0,
      doubleText: 0,
      delayedReplies: 0,
      caps: 0,
    };
  });

  const evidence = {
    control: [],
    aggression: [],
    breakup: [],
    passive: [],
    apology: [],
    delayed: [],
    doubleText: [],
    romance: [],
    friendship: [],
    work: [],
  };

  const recordEvidence = (kind, item) => {
    if (!evidence[kind]) evidence[kind] = [];
    const key = `${item.ts}-${item.title}-${item.detail}`;
    if (evidence[kind].some(existing => existing.key === key)) return;
    evidence[kind].push({ ...item, key });
  };

  const messageEvidence = (message, title, detail, weight = 1) => ({
    ts: +message.date,
    date: formatEvidenceDate(message.date),
    title,
    detail,
    quote: cleanQuote(message.body),
    weight,
  });

  let romance = 0;
  let friendship = 0;
  let work = 0;

  for (const message of messages) {
    if (!tracked.has(message.name)) continue;
    const body = message.body.trim();
    const sender = stats[message.name];
    if (CONTROL_RE.test(body)) {
      sender.control++;
      recordEvidence("control", messageEvidence(message, `${message.name} pushed for an immediate reply or update.`, `"${cleanQuote(body)}"`, 5));
    }
    if (AGGRO_RE.test(body) || capsBurst(body)) {
      sender.aggression++;
      if (capsBurst(body)) sender.caps++;
      recordEvidence("aggression", messageEvidence(message, `${message.name} used escalated or hostile wording.`, `"${cleanQuote(body)}"`, 5));
    }
    if (BREAKUP_RE.test(body)) {
      sender.breakup++;
      recordEvidence("breakup", messageEvidence(message, `${message.name} used exit or breakup wording.`, `"${cleanQuote(body)}"`, 6));
    }
    if (APOLOGY_RE.test(body)) {
      sender.apology++;
      recordEvidence("apology", messageEvidence(message, `${message.name} apologized after tension.`, `"${cleanQuote(body)}"`, 2));
    }
    if (isPassiveAggressive(body)) {
      sender.passive++;
      recordEvidence("passive", messageEvidence(message, `${message.name} replied with a clipped shutdown message.`, `"${cleanQuote(body)}"`, 3));
    }

    if (!isGroup) {
      if (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body)) {
        romance++;
        recordEvidence("romance", messageEvidence(message, `${message.name} used romantic language or couple-coded affection.`, `"${cleanQuote(body)}"`, 2));
      }
      if (FRIEND_RE.test(body)) {
        friendship++;
        recordEvidence("friendship", messageEvidence(message, `${message.name} used clearly platonic language.`, `"${cleanQuote(body)}"`, 1));
      }
      if (WORK_RE.test(body)) {
        work++;
        recordEvidence("work", messageEvidence(message, `${message.name} brought the chat back to work or logistics.`, `"${cleanQuote(body)}"`, 1));
      }
    }
  }

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (!tracked.has(prev.name) || !tracked.has(curr.name)) continue;
    const gapMin = (curr.date - prev.date) / 60000;

    if (curr.name === prev.name && gapMin < 180) {
      stats[curr.name].doubleText++;
      recordEvidence("doubleText", {
        ts: +curr.date,
        date: formatEvidenceDate(curr.date),
        title: `${curr.name} sent another message before getting a reply.`,
        detail: `"${cleanQuote(curr.body)}"`,
        weight: 2,
      });
      continue;
    }

    if (curr.name !== prev.name && gapMin > (isGroup ? 360 : 240)) {
      stats[curr.name].delayedReplies++;
      recordEvidence("delayed", {
        ts: +curr.date,
        date: formatEvidenceDate(curr.date),
        title: `${curr.name} replied after a long gap.`,
        detail: `${formatGap(gapMin)} after ${prev.name}'s message: "${cleanQuote(prev.body, 54)}"`,
        weight: 3,
      });
    }
  }

  const totals = Object.values(stats).reduce((acc, item) => {
    Object.entries(item).forEach(([key, value]) => {
      acc[key] = (acc[key] || 0) + value;
    });
    return acc;
  }, {});

  const topBy = key => [...namesAll].sort((a, b) => (stats[b]?.[key] || 0) - (stats[a]?.[key] || 0))[0] || namesSorted[0];
  const totalMessages = msgCounts.reduce((sum, count) => sum + count, 0) || 1;
  const leadShare = msgCounts[0] / totalMessages;
  const leadStarter = Object.entries(starterCount || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || namesSorted[0];
  const firstEvidence = kind => (evidence[kind] || []).sort((a, b) => b.weight - a.weight || b.ts - a.ts)[0];

  const flagPool = [];
  const pushFlag = (score, title, detail, sample) => {
    flagPool.push({
      score,
      title,
      detail,
      evidence: sample ? `${sample.date} • ${sample.detail}` : "",
    });
  };

  if (totals.control >= (isGroup ? 2 : 1)) {
    const name = topBy("control");
    pushFlag(
      totals.control * 4,
      "Reply pressure",
      `${name} used immediate-reply or location-check language ${totals.control} time${totals.control === 1 ? "" : "s"} in the sampled chat.`,
      firstEvidence("control")
    );
  }

  if (totals.aggression + totals.caps >= (isGroup ? 2 : 1)) {
    const name = topBy("aggression");
    pushFlag(
      (totals.aggression + totals.caps) * 4,
      "Escalated wording",
      `${name} is responsible for most of the hostile wording or all-caps escalation moments in the sample.`,
      firstEvidence("aggression")
    );
  }

  if (totals.breakup >= 1) {
    pushFlag(
      totals.breakup * 5,
      isGroup ? "Exit threats" : "Breakup language",
      isGroup
        ? `The group includes explicit “I’m done” or leave-the-chat style wording instead of simple cooling-off messages.`
        : `The chat includes explicit “we’re done” or end-of-relationship wording, which points to instability rather than a one-off disagreement.`,
      firstEvidence("breakup")
    );
  }

  if (!isGroup && totals.apology >= 3 && totals.control + totals.aggression + totals.breakup + totals.passive >= 2) {
    pushFlag(
      totals.apology * 2 + totals.aggression * 2,
      "Conflict-reset cycle",
      `There are repeated apologies after tense moments, which suggests the conflict pattern returns instead of fully resolving.`,
      firstEvidence("apology")
    );
  }

  if (!isGroup) {
    const chaser = topBy("doubleText");
    if ((stats[chaser]?.doubleText || 0) >= 5 || leadShare >= 0.64) {
      pushFlag(
        (stats[chaser]?.doubleText || 0) + leadShare * 5,
        "Uneven pursuit",
        `${chaser} does substantially more follow-up messaging, so the effort balance in the conversation looks uneven.`,
        firstEvidence("doubleText")
      );
    }

    const ghoster = topBy("delayedReplies");
    if ((stats[ghoster]?.delayedReplies || 0) >= 3) {
      pushFlag(
        (stats[ghoster]?.delayedReplies || 0) * 2,
        "Long reply gaps",
        `${ghoster} is the person most associated with multi-hour reply gaps after emotionally charged messages.`,
        firstEvidence("delayed")
      );
    }

    if (romance >= 6 && totals.control + totals.aggression + totals.breakup >= 2) {
      pushFlag(
        romance + totals.control + totals.aggression + totals.breakup,
        "Affection mixed with conflict",
        `The chat shows clear romantic cues, but those sit alongside pressure, escalation, or breakup language often enough to matter.`,
        firstEvidence("romance") || firstEvidence("breakup")
      );
    }
  } else {
    const loudest = namesSorted[0];
    if (leadShare >= 0.46) {
      pushFlag(
        leadShare * 10,
        "Dominant voice",
        `${loudest} sends such a large share of the messages that the group’s tone is heavily shaped by one person.`,
        firstEvidence("doubleText") || firstEvidence("aggression")
      );
    }

    if ((starterCount?.[leadStarter] || 0) >= 5) {
      pushFlag(
        (starterCount?.[leadStarter] || 0) * 0.8,
        "Single-person reactivation",
        `${leadStarter} is repeatedly the one restarting the chat, which suggests the group depends on one engine to stay active.`
      );
    }
  }

  if (flagPool.length < 3 && totals.passive >= 2) {
    pushFlag(
      totals.passive * 2,
      "Shutdown replies",
      `The chat contains multiple clipped replies like “fine” or “whatever,” which usually close the conversation without resolving the issue.`,
      firstEvidence("passive")
    );
  }

  if (flagPool.length < 3) {
    pushFlag(
      leadShare * 4,
      isGroup ? "Participation imbalance" : "Message imbalance",
      isGroup
        ? `A small number of people carry most of the momentum, so quieter members can disappear from the actual dynamic.`
        : `${namesSorted[0]} sends a much larger share of the messages, which is a factual imbalance in effort even before tone is considered.`
    );
  }

  if (flagPool.length < 3) {
    pushFlag(
      1,
      isGroup ? "Unstable group tone" : "Mixed signals",
      isGroup
        ? `The tone shifts fast across the sample, which makes the group dynamic feel inconsistent even when no single fight dominates.`
        : `The tone and pacing change enough across the sample that the relationship looks unclear from the chat alone.`
    );
  }

  const redFlags = flagPool
    .sort((a, b) => b.score - a.score)
    .filter((flag, index, arr) => arr.findIndex(other => other.title === flag.title) === index)
    .slice(0, 3)
    .map(({ title, detail, evidence: sample }) => ({ title, detail, evidence: sample }));

  const toxicityScores = {};
  namesAll.forEach(name => {
    const item = stats[name];
    toxicityScores[name] =
      item.control * 4 +
      item.aggression * 5 +
      item.breakup * 4 +
      item.passive * 2 +
      item.caps * 2 +
      item.delayedReplies * 1.5 +
      Math.max(item.doubleText - 2, 0) * 0.4;
  });

  const toxicRank = [...namesAll].sort((a, b) => toxicityScores[b] - toxicityScores[a]);
  const topToxic = toxicRank[0] || namesSorted[0];
  const runnerUp = toxicRank[1] || topToxic;
  const toxicPerson = toxicityScores[topToxic] - toxicityScores[runnerUp] < 2 ? "Tie" : topToxic;

  let toxicReason = isGroup
    ? "The highest-risk behaviours are spread across the group rather than clearly owned by one person."
    : "The risk signals are fairly shared, so the chat does not point to one clearly more toxic person.";

  if (toxicPerson !== "Tie") {
    const winner = stats[toxicPerson];
    const drivers = [];
    if (winner.control) drivers.push(`${winner.control} control/reply-pressure message${winner.control === 1 ? "" : "s"}`);
    if (winner.aggression || winner.caps) drivers.push(`${winner.aggression + winner.caps} escalated wording moment${winner.aggression + winner.caps === 1 ? "" : "s"}`);
    if (winner.breakup) drivers.push(`${winner.breakup} breakup/exit threat${winner.breakup === 1 ? "" : "s"}`);
    if (winner.passive) drivers.push(`${winner.passive} shutdown ${winner.passive === 1 ? "reply" : "replies"}`);
    if (winner.delayedReplies) drivers.push(`${winner.delayedReplies} long reply gap${winner.delayedReplies === 1 ? "" : "s"}`);
    toxicReason = `${toxicPerson} has the highest toxicity score because the sampled chat shows ${drivers.slice(0, 3).join(", ")} from them.`;
  }

  let relationshipStatus = null;
  let relationshipStatusWhy = null;
  let statusEvidence = null;

  if (!isGroup) {
    const conflict = totals.control + totals.aggression + totals.breakup + totals.passive;
    const romanceExample = firstEvidence("romance");
    const friendExample = firstEvidence("friendship");
    const workExample = firstEvidence("work");

    if (work >= Math.max(romance, friendship) + 3) {
      relationshipStatus = "Coworkers who overshare";
      relationshipStatusWhy = `The sample contains noticeably more work/logistics cues (${work}) than romantic ones (${romance}).`;
      statusEvidence = workExample ? `${workExample.date} • ${workExample.detail}` : "";
    } else if (romance >= 8 && conflict >= 4) {
      relationshipStatus = "On-and-off romance";
      relationshipStatusWhy = `There are strong romantic cues (${romance}) alongside repeated conflict markers (${conflict}), which points to attachment with instability.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (romance >= 8) {
      relationshipStatus = "Probably dating";
      relationshipStatusWhy = `The chat shows repeated romantic language (${romance} cues) and very little purely work-style or platonic framing.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (romance >= 4 && friendship >= 2) {
      relationshipStatus = "Situationship territory";
      relationshipStatusWhy = `The sample mixes romantic cues (${romance}) with platonic framing (${friendship}), so the connection looks emotionally close but not fully defined.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (friendship >= romance + 2) {
      relationshipStatus = "Close friends";
      relationshipStatusWhy = `The chat leans more on comfort and platonic language (${friendship} cues) than overt romantic signals (${romance}).`;
      statusEvidence = friendExample ? `${friendExample.date} • ${friendExample.detail}` : "";
    } else {
      relationshipStatus = "Complicated, but not official";
      relationshipStatusWhy = "The sample shows emotional closeness, but the wording is too mixed to point cleanly to friendship, dating, or a purely practical relationship.";
      statusEvidence = romanceExample?.detail || friendExample?.detail || workExample?.detail || "";
    }
  }

  const evidenceTimeline = Object.values(evidence)
    .flat()
    .sort((a, b) => b.weight - a.weight || b.ts - a.ts)
    .slice(0, 5)
    .map(item => ({ date: item.date, title: item.title, detail: item.detail }));

  const maxToxicity = Math.max(...Object.values(toxicityScores), 0);
  const toxicityLevel = maxToxicity >= 18 ? "Heated" : maxToxicity >= 9 ? "Tense" : "Healthy";
  const toxicityBreakdown = toxicRank.slice(0, Math.min(isGroup ? 4 : 2, toxicRank.length)).map(name => {
    const item = stats[name];
    const reasons = [];
    if (item.control) reasons.push(`${item.control} control`);
    if (item.aggression || item.caps) reasons.push(`${item.aggression + item.caps} escalation`);
    if (item.breakup) reasons.push(`${item.breakup} exit threat`);
    if (item.passive) reasons.push(`${item.passive} shutdown`);
    if (item.delayedReplies) reasons.push(`${item.delayedReplies} long-gap reply`);
    return `${name}: ${Math.round(toxicityScores[name])} points${reasons.length ? ` • ${reasons.join(", ")}` : ""}`;
  });
  const toxicityReport =
    toxicityLevel === "Heated"
      ? `High toxicity signal. The chat contains repeated pressure, escalation, or exit-style language that goes beyond one isolated argument.`
      : toxicityLevel === "Tense"
        ? `Moderate toxicity signal. There are repeated patterns worth paying attention to, even if the sample is not hostile all the time.`
        : `Low toxicity signal. The sample has some tension markers, but they appear limited or inconsistent rather than dominant.`;

  return {
    relationshipStatus,
    relationshipStatusWhy,
    statusEvidence,
    toxicPerson,
    toxicReason,
    redFlags,
    toxicityScores,
    evidenceTimeline,
    toxicityLevel,
    toxicityReport,
    toxicityBreakdown,
  };
}

function localStats(messages) {
  if (!messages.length) return null;
  const rawNames = [...new Set(messages.map(m => m.name))];
  const byNameRaw = {};
  rawNames.forEach(n => (byNameRaw[n] = []));
  messages.forEach(m => byNameRaw[m.name]?.push(m));
  // Filter out group name — any "sender" with fewer than 3 messages is likely the group name or a system entry
  const namesAll = rawNames.filter(n => byNameRaw[n].length >= 3);
  const isGroup  = namesAll.length > 2;
  const byName   = {};
  namesAll.forEach(n => (byName[n] = byNameRaw[n]));
  const namesSorted = [...namesAll].sort((a,b) => byName[b].length - byName[a].length);

  const wordFreq = {};
  messages.forEach(({body}) => {
    if (/media omitted|image omitted|video omitted|voice omitted|audio omitted|<media|<attached/i.test(body) || body.startsWith("http")) return;
    body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w => {
      if (w.length>2 && !TOKEN_STOP_WORDS.has(w) && !TOKEN_WA_NOISE_WORDS.has(w) && !/^\d+$/.test(w)) wordFreq[w]=(wordFreq[w]||0)+1;
    });
  });
  const topWords = Object.entries(wordFreq).sort((a,b)=>b[1]-a[1]).slice(0,10);

  const emojiRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  const emojiFreq = {};
  messages.forEach(({body}) => (body.match(emojiRe)||[]).forEach(e => (emojiFreq[e]=(emojiFreq[e]||0)+1)));
  const spiritEmojiAll = Object.entries(emojiFreq).sort((a,b)=>b[1]-a[1])[0]?.[0]||"💬";
  const spiritByName = {};
  namesAll.forEach(n => {
    const ef = {};
    byName[n].forEach(({body}) => (body.match(emojiRe)||[]).forEach(e => (ef[e]=(ef[e]||0)+1)));
    spiritByName[n] = Object.entries(ef).sort((a,b)=>b[1]-a[1])[0]?.[0]||"💬";
  });

  const mediaByName = {}, linkByName = {}, voiceByName = {};
  namesAll.forEach(n => {
    mediaByName[n] = byName[n].filter(m => /media omitted|image omitted|video omitted/i.test(m.body)).length;
    linkByName[n]  = byName[n].filter(m => m.body.includes("http")).length;
    voiceByName[n] = byName[n].filter(m => /voice omitted|audio omitted/i.test(m.body)).length;
  });

  const peakHourByName = {};
  namesAll.forEach(n => {
    const h = new Array(24).fill(0);  // fresh array per person
    byName[n].forEach(m => { if(m.hour>=0 && m.hour<24) h[m.hour]++; });
    const maxVal = Math.max(...h);
    peakHourByName[n] = maxVal > 0 ? h.indexOf(maxVal) : 12; // default noon if no data
  });
  const fmtHour = h => h===0?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`;

  const avgLenByName = {}, maxLenByName = {};
  namesAll.forEach(n => {
    const msgs = byName[n].filter(m => !/media omitted|voice omitted|audio omitted/i.test(m.body) && !m.body.startsWith("http"));
    avgLenByName[n] = msgs.length ? Math.round(msgs.reduce((s,m)=>s+m.body.length,0)/msgs.length) : 0;
    maxLenByName[n] = msgs.length ? Math.max(...msgs.map(m=>m.body.length)) : 0;
  });

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthFreq = {};
  messages.forEach(m => { const k=`${m.year}-${String(m.month).padStart(2,"0")}`; monthFreq[k]=(monthFreq[k]||0)+1; });
  const topMonths = Object.entries(monthFreq).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v]) => { const [y,mo]=k.split("-"); return [`${MONTHS[+mo]} ${y}`,v]; });

  const daySet  = new Set(messages.map(m=>m.date.toDateString()));
  const dayList = [...daySet].map(d=>new Date(d)).sort((a,b)=>a-b);
  let maxStreak=1, cur=1;
  for(let i=1;i<dayList.length;i++){cur=(dayList[i]-dayList[i-1])/86400000===1?cur+1:1;if(cur>maxStreak)maxStreak=cur;}

  const starterCount = {};
  namesAll.forEach(n=>(starterCount[n]=0));
  const firstByDay = {};
  messages.forEach(m=>{const d=m.date.toDateString();if(!firstByDay[d])firstByDay[d]=m;});
  Object.values(firstByDay).forEach(m=>{if(m.name in starterCount)starterCount[m.name]++;});
  const topStarterEntry = Object.entries(starterCount).sort((a,b)=>b[1]-a[1])[0];
  const starterPct = topStarterEntry?`${Math.round((topStarterEntry[1]/Object.keys(firstByDay).length)*100)}%`:"50%";

  const killerCount = {};
  namesAll.forEach(n=>(killerCount[n]=0));
  for(let i=0;i<messages.length-1;i++){if((messages[i+1].date-messages[i].date)/60000>120)killerCount[messages[i].name]++;}
  const topKillerEntry = Object.entries(killerCount).sort((a,b)=>b[1]-a[1])[0];

  let ghostAvg=["?","?"], ghostName=namesSorted[0], ghostEqual=false;
  if(!isGroup && namesAll.length>=2){
    const rt={};namesAll.forEach(n=>(rt[n]=[]));
    for(let i=1;i<messages.length;i++){
      const prev=messages[i-1],curr=messages[i];
      if(curr.name!==prev.name && curr.name in rt){const d=(curr.date-prev.date)/60000;if(d>1&&d<1440)rt[curr.name].push(d);}
    }
    const rawAvgMin=n=>{const a=rt[n]||[];return a.length?Math.round(a.reduce((s,t)=>s+t,0)/a.length):0;};
    const fmtMinutes=mins=>{if(!mins)return"instant";return mins<60?`${mins}m`:`${Math.floor(mins/60)}h ${mins%60}m`;};
    const fmt=n=>fmtMinutes(rawAvgMin(n));
    const a0=fmt(namesSorted[0]),a1=fmt(namesSorted[1]||namesSorted[0]);
    ghostAvg=[a0,a1];
    const raw0=rawAvgMin(namesSorted[0]),raw1=rawAvgMin(namesSorted[1]);
    ghostName=raw0>=raw1?namesSorted[0]:namesSorted[1];
    ghostEqual=raw0>0&&raw1>0&&Math.abs(raw0-raw1)<30;
  }

  // ── Therapist detection ──
  // Who sends their longest replies in response to emotional or heavy messages?
  // Emotional triggers: messages with feeling words OR messages >120 chars
  const EMOTIONAL = /sad|miss|cry|tired|stressed|anxious|scared|worried|hurt|sorry|hard|difficult|broken|lost|alone|upset|angry|feel|pain|help|support|struggling/i;
  const therapistScore = {};
  namesAll.forEach(n => (therapistScore[n] = []));
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i-1], curr = messages[i];
    if (curr.name === prev.name) continue;
    if (!(curr.name in therapistScore)) continue;
    const prevIsEmotional = EMOTIONAL.test(prev.body) || prev.body.length > 120;
    if (prevIsEmotional && curr.body.length > 60 && !/media omitted|voice omitted|audio omitted|<attached/i.test(curr.body)) {
      therapistScore[curr.name].push(curr.body.length);
    }
  }
  // Score = avg length of emotional replies × number of them (weighted)
  const therapistRank = {};
  namesAll.forEach(n => {
    const arr = therapistScore[n];
    therapistRank[n] = arr.length > 0 ? (arr.reduce((s,v)=>s+v,0)/arr.length) * Math.log(arr.length+1) : 0;
  });
  const therapist = [...namesAll].sort((a,b) => therapistRank[b]-therapistRank[a])[0] || namesAll[0];
  const therapistCount = therapistScore[therapist]?.length || 0;

  const sigWordByName = {};
  namesAll.forEach(n=>{
    const wf={};
    byName[n].forEach(({body})=>{
      if(/media omitted|image omitted|video omitted|voice omitted|audio omitted|<media|<attached/i.test(body)||body.startsWith("http"))return;
      body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w=>{if(w.length>2&&!TOKEN_STOP_WORDS.has(w)&&!TOKEN_WA_NOISE_WORDS.has(w)&&!/^\d+$/.test(w))wf[w]=(wf[w]||0)+1;});
    });
    sigWordByName[n]=Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||"...";
  });

  // ── Funniest person — who CAUSED laugh reactions ──
  // LAUGH_RE is defined at module scope
  const isLaughReaction = body => {
    const b = body.trim().toLowerCase();
    if (LAUGH_RE.test(b)) return true;
    // keyboard smash: 8+ letters, low vowel ratio, no spaces
    if (/^[a-z]{8,}$/i.test(b)) {
      const vowelRatio = (b.match(/[aeiou]/g)||[]).length / b.length;
      return vowelRatio < 0.30;
    }
    return false;
  };
  const laughCausedBy = {};
  namesAll.forEach(n => (laughCausedBy[n] = 0));
  for (let i = 0; i < messages.length - 1; i++) {
    const curr = messages[i], next = messages[i+1];
    if (curr.name === next.name) continue;
    if (!(curr.name in laughCausedBy)) continue;
    if (isLaughReaction(next.body)) laughCausedBy[curr.name]++;
  }
  const funniestPerson = !isGroup && namesAll.length >= 2
    ? [...namesAll].sort((a,b) => laughCausedBy[b] - laughCausedBy[a])[0]
    : namesAll[0];

  const msgCounts = namesSorted.map(n => byName[n].length);
  const dynamics = spotDynamics({
    messages,
    namesAll,
    namesSorted,
    msgCounts,
    starterCount,
    isGroup,
  });

  return {
    analysisVersion: LOCAL_STATS_VERSION,
    isGroup, names: namesSorted,
    msgCounts,
    topWords, spiritEmoji: isGroup?[spiritEmojiAll]:namesSorted.map(n=>spiritByName[n]||"💬"),
    avgMsgLen: namesSorted.map(n=>avgLenByName[n]),
    maxMsgLen: namesSorted.map(n=>maxLenByName[n]),
    mediaCounts: namesSorted.map(n=>mediaByName[n]),
    linkCounts: namesSorted.map(n=>linkByName[n]),
    voiceCounts: namesSorted.map(n=>voiceByName[n]),
    peakHour: namesSorted.map(n=>fmtHour(peakHourByName[n])),
    signatureWord: namesSorted.map(n=>sigWordByName[n]),
    ghostAvg, ghostName, ghostEqual, streak: maxStreak, funniestPerson, laughCausedBy,
    topMonths: topMonths.length?topMonths:[["This month",messages.length]],
    convStarter: topStarterEntry?.[0]||namesSorted[0], convStarterPct: starterPct,
    convKiller: topKillerEntry?.[0]||namesSorted[0], convKillerCount: topKillerEntry?.[1]||0,
    mainChar:     isGroup?namesSorted[0]:null,
    ghost:        isGroup?namesSorted[namesSorted.length-1]:null,
    novelist:     isGroup?[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]:null,
    novelistMaxLen: isGroup?maxLenByName[[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]]||0:0,
    novelistLongestTopic: (() => {
      if (!isGroup) return null;
      const nov = [...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0];
      const msgs = (byName[nov]||[]).filter(m=>!/media omitted|voice omitted|audio omitted|<attached/i.test(m.body)&&!m.body.startsWith("http"));
      const longest = msgs.sort((a,b)=>b.body.length-a.body.length)[0];
      if (!longest) return null;
      const wf = {};
      longest.body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w=>{
        if(w.length>3&&!TOKEN_STOP_WORDS.has(w)&&!TOKEN_WA_NOISE_WORDS.has(w)&&!/^\d+$/.test(w))wf[w]=(wf[w]||0)+1;
      });
      return Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    })(),
    hype:         isGroup?topStarterEntry?.[0]||namesAll[0]:null,
    photographer: isGroup?(()=>{ const p=[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]; return p||null; })():null,
    photographerIsVoice: isGroup?(()=>{ const p=[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]; return p&&voiceByName[p]>mediaByName[p]; })():false,
    voiceChampion: isGroup?[...namesAll].sort((a,b)=>voiceByName[b]-voiceByName[a])[0]:null,
    linkDumper:   isGroup?[...namesAll].sort((a,b)=>linkByName[b]-linkByName[a])[0]:null,
    therapist:    isGroup?therapist:null,
    therapistCount: isGroup?therapistCount:0,
    nightOwl:     isGroup?[...namesAll].sort((a,b)=>peakHourByName[b]-peakHourByName[a])[0]:null,
    earlyBird:    isGroup?[...namesAll].sort((a,b)=>peakHourByName[a]-peakHourByName[b])[0]:null,
    mostHyped:    isGroup?namesSorted[1]||namesSorted[0]:null,
    totalMessages: messages.length,
    relationshipStatus: dynamics.relationshipStatus,
    relationshipStatusWhy: dynamics.relationshipStatusWhy,
    statusEvidence: dynamics.statusEvidence,
    toxicPerson: dynamics.toxicPerson,
    toxicReason: dynamics.toxicReason,
    redFlags: dynamics.redFlags,
    toxicityScores: namesSorted.map(name => Math.round(dynamics.toxicityScores[name] || 0)),
    evidenceTimeline: dynamics.evidenceTimeline,
    toxicityLevel: dynamics.toxicityLevel,
    toxicityReport: dynamics.toxicityReport,
    toxicityBreakdown: dynamics.toxicityBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────
// EVENT-BASED SAMPLING PIPELINE
// ─────────────────────────────────────────────────────────────────

const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Format a single message line — timestamp always includes speaker name
function formatMessageLine(m) {
  const d  = m.date;
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `[${ts}] ${m.name}: ${m.body}`;
}

// Flat formatter kept for growth analysis early/late contiguous slices
function formatForAI(messages) {
  return messages.map(formatMessageLine).join("\n");
}

// Assign an event score and tag set to every message position.
// Higher score = more valuable to anchor a context window on.
function scoreMessages(messages) {
  return messages.map((msg, i) => {
    let score = 0;
    const tags = [];
    // Skip pure media placeholders for signal detection
    const body = /^<(Voice|Media) omitted>$/.test(msg.body) ? "" : msg.body;

    // Reply-gap signal — long silences often bracket important exchanges
    if (i > 0) {
      const gapMin = (msg.date - messages[i - 1].date) / 60000;
      if (gapMin > 240)     { score += 4; tags.push("long-gap"); }
      else if (gapMin > 60) { score += 2; tags.push("gap"); }
    }

    // Conflict signals
    if (body && (CONTROL_RE.test(body) || AGGRO_RE.test(body) || BREAKUP_RE.test(body))) {
      score += 6; tags.push("conflict");
    }

    // Apology clusters
    if (body && APOLOGY_RE.test(body)) {
      score += 4; tags.push("apology");
    }

    // Romantic / affection spikes
    if (body && (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body))) {
      score += 4; tags.push("affection");
    }

    // Long message — likely something substantive
    if (body.length > 200) { score += 2; tags.push("long-msg"); }

    // Laugh-trigger: this message caused a laugh reaction from a DIFFERENT speaker
    // in the next 1–3 messages. Preserving these windows (with their tail) lets
    // Claude see exactly whose line made someone laugh — not just what sounds funny.
    for (let j = i + 1; j <= Math.min(i + 3, messages.length - 1); j++) {
      if (messages[j].name !== msg.name && LAUGH_RE.test(messages[j].body)) {
        score += 5; tags.push("laugh-trigger");
        break;
      }
    }

    return { score, tags };
  });
}

// Merge overlapping or adjacent [start, end, tags[]] intervals
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [[...sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], sorted[i][1]);
      last[2] = [...new Set([...(last[2] || []), ...(sorted[i][2] || [])])];
    } else {
      out.push([...sorted[i]]);
    }
  }
  return out;
}

// Human-readable label for a chunk header, derived from its tag set
function chunkLabel(tags = []) {
  if (tags.includes("conflict"))      return "conflict";
  if (tags.includes("apology"))       return "apology";
  if (tags.includes("laugh-trigger")) return "funny moment";
  if (tags.includes("affection"))     return "affection";
  if (tags.includes("long-gap"))      return "after silence";
  if (tags.includes("long-msg"))      return "long message";
  return "excerpt";
}

// Build the ordered list of [startIdx, endIdx, tags[]] windows to send to Claude.
//
// Two-pass strategy:
//   1. Event windows  — anchor on high-scoring messages, include enough surrounding
//      context that speaker direction and laugh reactions are unambiguous.
//   2. Timeline fill  — add short baseline windows for time buckets not yet covered,
//      so Claude always sees something from every major period of the chat.
function buildChunks(messages) {
  if (!messages.length) return [];

  const CONTEXT_BEFORE      = 4;   // lines before each event center
  const CONTEXT_AFTER       = 5;   // lines after event center (default)
  const CONTEXT_AFTER_LAUGH = 8;   // extended tail for laugh-trigger windows
                                   //   — captures the reaction(s) that follow the funny line
  const EVENT_SCORE_MIN     = 4;   // minimum score to qualify as an event center
  const MAX_EVENT_WINDOWS   = 55;  // hard cap on event-based windows
  const TIMELINE_BUCKETS    = 28;  // time segments for baseline coverage
  const LINES_PER_BUCKET    = 5;   // messages per uncovered timeline window
  const MSG_LINE_LIMIT      = 1400; // hard cap on total message lines (headers not counted)

  const n      = messages.length;
  const scores = scoreMessages(messages);

  // ── Pass 1: event windows ──
  // Sort all candidates by descending score, then limit density so we never
  // take more than one event center within any 8-message neighbourhood.
  const candidates = scores
    .map((s, i) => ({ i, score: s.score, tags: s.tags }))
    .filter(x => x.score >= EVENT_SCORE_MIN)
    .sort((a, b) => b.score - a.score);

  const takenCenters  = new Set();
  const eventWindows  = [];
  for (const c of candidates) {
    if (takenCenters.has(c.i)) continue;
    for (let k = Math.max(0, c.i - 4); k <= Math.min(n - 1, c.i + 4); k++) takenCenters.add(k);
    const after = c.tags.includes("laugh-trigger") ? CONTEXT_AFTER_LAUGH : CONTEXT_AFTER;
    eventWindows.push([
      Math.max(0, c.i - CONTEXT_BEFORE),
      Math.min(n - 1, c.i + after),
      c.tags,
    ]);
    if (eventWindows.length >= MAX_EVENT_WINDOWS) break;
  }

  // ── Pass 2: timeline fill ──
  // Divide the chat's time span into equal buckets.  Any bucket with no event
  // coverage gets a short window centred on its midpoint message.
  const firstTs = messages[0].date.getTime();
  const lastTs  = messages[n - 1].date.getTime();
  const span    = Math.max(lastTs - firstTs, 1);

  const mergedEvents = mergeIntervals(eventWindows);
  const coveredSet   = new Set();
  mergedEvents.forEach(([s, e]) => { for (let k = s; k <= e; k++) coveredSet.add(k); });

  const timelineWindows = [];
  for (let b = 0; b < TIMELINE_BUCKETS; b++) {
    const lo = firstTs + (b / TIMELINE_BUCKETS) * span;
    const hi = firstTs + ((b + 1) / TIMELINE_BUCKETS) * span;
    const bucket = [];
    for (let i = 0; i < n; i++) {
      const ts = messages[i].date.getTime();
      if (ts >= lo && ts < hi) bucket.push(i);
    }
    if (!bucket.length || bucket.some(i => coveredSet.has(i))) continue;
    const center = bucket[Math.floor(bucket.length / 2)];
    timelineWindows.push([
      Math.max(0, center - 2),
      Math.min(n - 1, center + LINES_PER_BUCKET - 1),
      ["timeline"],
    ]);
  }

  // ── Merge, sort, enforce line budget ──
  const all = mergeIntervals([...eventWindows, ...timelineWindows])
    .sort((a, b) => a[0] - b[0]);

  let msgLines = 0;
  const result = [];
  for (const chunk of all) {
    const sz = chunk[1] - chunk[0] + 1;
    if (msgLines + sz > MSG_LINE_LIMIT) break;
    result.push(chunk);
    msgLines += sz;
  }
  return result;
}

// Render chunks as windowed text with ━━━ separators.
// Each header tells Claude: isolated excerpt, date, type of signal.
// Speaker name is always present on every message line — attribution is unambiguous.
function formatChunksForAI(messages, chunks) {
  const total = chunks.length;
  const parts = [];
  chunks.forEach(([start, end, tags], idx) => {
    const d       = messages[start].date;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]}`;
    parts.push(`\n━━━ WINDOW ${idx + 1}/${total} · ${dateStr} · ${chunkLabel(tags)} ━━━`);
    for (let i = start; i <= end; i++) parts.push(formatMessageLine(messages[i]));
  });
  return parts.join("\n");
}

// Main entry point — replaces the old smartSample(messages,N) + formatForAI(sample) pair.
// Short chats (≤600 messages) are delivered in full as a single window.
function buildSampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildChunks(messages));
}

async function callClaude(systemPrompt, userContent, maxTokens = 1500, schemaMode = "analysis") {
  const { data: { session } } = await supabase.auth.getSession();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ system: systemPrompt, userContent, max_tokens: maxTokens, schema_mode: schemaMode }),
        signal: controller.signal,
      }
    );
    if (!res.ok) throw new Error(`Edge function error ${res.status}`);
    const raw = await res.json();
    return extractClaudePayload(raw);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Analysis timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function tryParseJsonText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function isAnalysisPayload(value) {
  return !!(
    value &&
    typeof value === "object" &&
    (
      Array.isArray(value.people) ||
      (value.shared && typeof value.shared === "object") ||
      (value.meta && typeof value.meta === "object")
    )
  );
}

function extractClaudePayload(raw) {
  const queue = [raw];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current === "string") {
      const parsed = tryParseJsonText(current);
      if (parsed) queue.unshift(parsed);
      continue;
    }

    if (Array.isArray(current)) {
      current.forEach(item => queue.push(item));
      continue;
    }

    if (typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (isAnalysisPayload(current)) return current;

    [
      "analysis",
      "result",
      "data",
      "payload",
      "parsed",
      "json",
      "response",
      "output",
      "completion",
      "choices",
      "choice",
      "candidate",
      "candidates",
      "answer",
      "artifact",
      "text",
      "content",
      "message",
      "messages",
      "delta",
      "raw",
      "body",
    ].forEach(key => {
      if (key in current) queue.push(current[key]);
    });
  }

  return raw;
}

const CORE_ANALYSIS_VERSION = 2;
const LOCAL_STATS_VERSION = 3;
const CORE_ANALYSIS_CACHE_VERSION = 3;
const APP_BUILD_ID = "2026.04.10-3";
const CORE_A_MAX_TOKENS = 2600;
const CORE_B_MAX_TOKENS = 2600;

function buildRelationshipContextBlock(relType) {
  const relCtx = relContextStr(relType);
  return relCtx
    ? ` RELATIONSHIP CONTEXT: ${relCtx}. Frame all analysis, tone, and language accordingly. Do not label a partner dynamic as friendship or chosen family. Do not label a family dynamic as romantic.`
    : "";
}

function buildLangInstruction(chatLang) {
  if (!chatLang || chatLang === "en") return "";
  const label = LANG_META[chatLang];
  if (!label) return "";
  return `\n\nOUTPUT LANGUAGE: Write all free-text fields (sentences, summaries, descriptions, examples, context, verdicts, reasons, and analysis) in ${label}. The JSON structure and all key names must remain exactly as specified in the schema.\n\nThe following fields are schema-critical control tokens — reproduce them EXACTLY as listed here, with zero translation:\n- "language" (careStyle): must be one of exactly: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed\n- "depthChange": must be one of exactly: deeper / shallower / about the same\n- "trajectory": must be one of exactly: closer / drifting / stable\n- "type" (energy): must be one of exactly: net positive / mixed / net draining\n- "dramaStarter": a first name as written in the chat, or exactly "Shared", or exactly "None clearly identified"\n- "toxicPerson": a first name as written in the chat, or exactly "Tie", or exactly "None clearly identified"\n- "funniestPerson": a first name as written in the chat, or exactly "None clearly identified"\n- "kindestPerson": a first name as written in the chat, or exactly "None clearly identified"\n- "whoChangedMore": a first name as written in the chat, or exactly "Both equally"\n- "powerHolder": a first name as written in the chat, or exactly "Balanced"\n- "person" in promise/apology fields: a first name as written in the chat, or exactly "None clearly identified"\n- All "name" fields: the exact first name as it appears in the chat\nDo NOT translate, paraphrase, or modify these control tokens under any circumstances. All descriptive text fields — everything else — must be in ${label}.`;
}

function buildAnalystSystemPrompt(role, relationshipType, extraRules = "", chatLang = "en") {
  return `You are WrapChat, ${role}. Be specific, grounded, and evidence-led. Reference real patterns, real phrases, and real moments from the chat instead of generic observations. Be conservative before singling out one person: if the evidence is mixed, close, or mostly based on tone, prefer balanced labels like "Tie", "Shared", "Balanced", or "None clearly identified" instead of over-assigning blame. Do not pile onto the loudest or most active person unless multiple distinct examples support it. Keep the tone honest but not cruel, mocking, or absolute. Avoid repetitive wording across fields: if two answers overlap, make them distinct in angle and concrete detail rather than repeating the same judgment. When negative and positive evidence coexist, acknowledge both. Return ONLY valid JSON with no markdown fences or explanation outside the JSON.${buildRelationshipContextBlock(relationshipType)}${extraRules ? ` ${extraRules}` : ""}${buildLangInstruction(chatLang)}`;
}

function clampScore(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(10, Math.round(num)));
}

function strOr(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanStringArray(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map(item => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function normalizeNamedScoreRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      name: strOr(item.name, `Person ${i + 1}`),
      score: clampScore(item.score, 5),
      detail: strOr(item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

function normalizeApologySummary(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    name: strOr(safe.name, "None clearly identified"),
    count: Math.max(0, Math.round(Number(safe.count) || 0)),
    context: strOr(safe.context),
  };
}

function normalizeMomentRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      date: strOr(item.date, `Moment ${i + 1}`),
      person: strOr(item.person),
      description: strOr(item.description || item.title),
      quote: strOr(item.quote || item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

function normalizePromiseMoment(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    person: strOr(safe.person, "None clearly identified"),
    promise: strOr(safe.promise),
    date: strOr(safe.date),
    outcome: strOr(safe.outcome),
  };
}

// Normalize schema-critical enum values that Claude may translate despite instructions.
// Maps common translations back to canonical English control tokens so the app's
// UI mappings (arrowMap, trajMap, love-language labels) keep working.
const LOVE_LANG_CANONICAL = [
  "Words of Affirmation",
  "Acts of Service",
  "Receiving Gifts",
  "Quality Time",
  "Physical Touch",
  "Mixed",
];
function normalizeLoveLanguage(v) {
  const s = String(v || "").trim();
  const exact = LOVE_LANG_CANONICAL.find(l => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const sl = s.toLowerCase();
  if (/affirm|onay|söz|szavak|parole|afirmación|palavras|aff/.test(sl)) return "Words of Affirmation";
  if (/service|servis|hizmet|actes|handlung|servicio|atos|acts/.test(sl)) return "Acts of Service";
  if (/gift|hediye|cadeau|geschenk|regalo|doni/.test(sl)) return "Receiving Gifts";
  if (/quality|nitelik|temps|zeit|tiempo|tempo/.test(sl) && /time|zaman/.test(sl)) return "Quality Time";
  if (/physical|fizik|fisique|körper|físic|fisic|touch|dokunuş/.test(sl)) return "Physical Touch";
  return s; // keep as-is if unrecognized (still renders, just without canonical label)
}
function normalizeDepthChange(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["deeper", "shallower", "about the same"].includes(s)) return s;
  if (/deep|derin|profond|tief|profund|más profund/.test(s)) return "deeper";
  if (/shallow|yüzey|superfic|flach|poco profund/.test(s)) return "shallower";
  if (/same|aynı|même|gleich|igual|stessa/.test(s)) return "about the same";
  return v;
}
function normalizeTrajectory(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["closer", "drifting", "stable"].includes(s)) return s;
  if (/clos|yakın|proche|näher|cerca|vicin/.test(s)) return "closer";
  if (/drift|uzaklaş|éloign|entfern|alej|allontan/.test(s)) return "drifting";
  if (/stable|stabil|estable|stabil/.test(s)) return "stable";
  return v;
}
function normalizeEnergyType(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["net positive", "mixed", "net draining"].includes(s)) return s;
  if (/positive|pozitif|positif|positivo|positiv/.test(s)) return "net positive";
  if (/drain|yoran|épuisant|erschöpf|agotador|sfiancant/.test(s)) return "net draining";
  if (/mixed|karma|mixte|gemischt|mixto|misto/.test(s)) return "mixed";
  return v;
}

function normalizeCorePersonA(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const care = safe.careStyle && typeof safe.careStyle === "object" ? safe.careStyle : {};
  const energy = safe.energy && typeof safe.energy === "object" ? safe.energy : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    summaryRole: strOr(safe.summaryRole),
    careStyle: {
      language: normalizeLoveLanguage(strOr(care.language, "Mixed")),
      languageEmoji: strOr(care.languageEmoji, "💝"),
      examples: strOr(care.examples),
      score: clampScore(care.score, 5),
    },
    energy: {
      netScore: clampScore(energy.netScore, 5),
      type: normalizeEnergyType(strOr(energy.type, "mixed")),
      goodNews: strOr(energy.goodNews),
      venting: strOr(energy.venting, "minimal venting"),
      hypeQuote: strOr(energy.hypeQuote),
    },
  };
}

function normalizeCorePersonB(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const health = safe.health && typeof safe.health === "object" ? safe.health : {};
  const accountability = safe.accountability && typeof safe.accountability === "object" ? safe.accountability : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    health: {
      score: clampScore(health.score, 5),
      detail: strOr(health.detail),
      apologyCount: Math.max(0, Math.round(Number(health.apologyCount) || 0)),
      apologyContext: strOr(health.apologyContext),
    },
    accountability: {
      total: Math.max(0, Math.round(Number(accountability.total) || 0)),
      kept: Math.max(0, Math.round(Number(accountability.kept) || 0)),
      broken: Math.max(0, Math.round(Number(accountability.broken) || 0)),
      score: clampScore(accountability.score, 5),
      detail: strOr(accountability.detail),
    },
  };
}

function normalizeCoreAnalysisA(raw, math, relationshipType) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const growth = shared.growth && typeof shared.growth === "object" ? shared.growth : {};
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, math?.isGroup ? Math.min(math?.names?.length || 0, 6) : 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonA(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "a",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
    },
    people,
    shared: {
      vibeOneLiner: strOr(shared.vibeOneLiner),
      biggestTopic: strOr(shared.biggestTopic),
      ghostContext: strOr(shared.ghostContext),
      funniestPerson: strOr(shared.funniestPerson),
      funniestReason: strOr(shared.funniestReason),
      dramaStarter: strOr(shared.dramaStarter),
      dramaContext: strOr(shared.dramaContext),
      signaturePhrases: cleanStringArray(shared.signaturePhrases, 2),
      relationshipStatus: strOr(shared.relationshipStatus),
      relationshipStatusWhy: strOr(shared.relationshipStatusWhy),
      statusEvidence: strOr(shared.statusEvidence),
      toxicPerson: strOr(shared.toxicPerson),
      toxicReason: strOr(shared.toxicReason),
      toxicityReport: strOr(shared.toxicityReport),
      redFlags: normalizeRedFlags(shared.redFlags),
      evidenceTimeline: normalizeTimeline(shared.evidenceTimeline),
      relationshipSummary: strOr(shared.relationshipSummary),
      groupDynamic: strOr(shared.groupDynamic),
      tensionMoment: strOr(shared.tensionMoment),
      kindestPerson: strOr(shared.kindestPerson),
      sweetMoment: strOr(shared.sweetMoment),
      mostMissed: strOr(shared.mostMissed),
      insideJoke: strOr(shared.insideJoke),
      hypePersonReason: strOr(shared.hypePersonReason),
      loveLanguageMismatch: strOr(shared.loveLanguageMismatch),
      mostLovingMoment: strOr(shared.mostLovingMoment),
      compatibilityScore: clampScore(shared.compatibilityScore, 5),
      compatibilityRead: strOr(shared.compatibilityRead),
      mostEnergising: strOr(shared.mostEnergising),
      mostDraining: strOr(shared.mostDraining),
      energyCompatibility: strOr(shared.energyCompatibility),
      growth: {
        thenDepth: strOr(growth.thenDepth),
        nowDepth: strOr(growth.nowDepth),
        depthChange: normalizeDepthChange(strOr(growth.depthChange)),
        whoChangedMore: strOr(growth.whoChangedMore),
        whoChangedHow: strOr(growth.whoChangedHow),
        topicsAppeared: strOr(growth.topicsAppeared),
        topicsDisappeared: strOr(growth.topicsDisappeared),
        trajectory: normalizeTrajectory(strOr(growth.trajectory)),
        trajectoryDetail: strOr(growth.trajectoryDetail),
        arcSummary: strOr(growth.arcSummary),
      },
    },
  };
}

function normalizeCoreAnalysisB(raw, math, relationshipType) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const toxicity = shared.toxicity && typeof shared.toxicity === "object" ? shared.toxicity : {};
  const accountability = shared.accountability && typeof shared.accountability === "object" ? shared.accountability : {};
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonB(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "b",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
    },
    people,
    shared: {
      toxicity: {
        chatHealthScore: clampScore(toxicity.chatHealthScore, 5),
        healthScores: normalizeNamedScoreRows(toxicity.healthScores),
        apologiesLeader: normalizeApologySummary(toxicity.apologiesLeader),
        apologiesOther: normalizeApologySummary(toxicity.apologiesOther),
        redFlagMoments: normalizeMomentRows(toxicity.redFlagMoments, 5),
        conflictPattern: strOr(toxicity.conflictPattern),
        powerBalance: strOr(toxicity.powerBalance),
        powerHolder: strOr(toxicity.powerHolder, "Balanced"),
        verdict: strOr(toxicity.verdict),
      },
      accountability: {
        notableBroken: normalizePromiseMoment(accountability.notableBroken),
        notableKept: normalizePromiseMoment(accountability.notableKept),
        overallVerdict: strOr(accountability.overallVerdict),
      },
    },
  };
}

function attachReportMeta(report, relationshipType, coreAnalysis = null) {
  return {
    ...(report && typeof report === "object" ? report : {}),
    relationshipType: relationshipType ?? null,
    ...(coreAnalysis ? { coreAnalysis } : {}),
  };
}

function pickCorePairA(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonA(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonA(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function pickCorePairB(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonB(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonB(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function deriveGeneralReportFromCore(core, math, relationshipType) {
  const shared = core?.shared || {};
  return attachReportMeta({
    funniestPerson: shared.funniestPerson || math?.funniestPerson || "",
    funniestReason: shared.funniestReason,
    ghostContext: shared.ghostContext,
    biggestTopic: shared.biggestTopic,
    dramaStarter: shared.dramaStarter,
    dramaContext: shared.dramaContext,
    signaturePhrase: shared.signaturePhrases?.length ? shared.signaturePhrases : undefined,
    relationshipStatus: shared.relationshipStatus,
    relationshipStatusWhy: shared.relationshipStatusWhy,
    statusEvidence: shared.statusEvidence,
    toxicPerson: shared.toxicPerson,
    toxicReason: shared.toxicReason,
    evidenceTimeline: shared.evidenceTimeline,
    redFlags: shared.redFlags,
    toxicityReport: shared.toxicityReport,
    relationshipSummary: shared.relationshipSummary,
    tensionMoment: shared.tensionMoment,
    kindestPerson: shared.kindestPerson,
    sweetMoment: shared.sweetMoment,
    vibeOneLiner: shared.vibeOneLiner,
    groupDynamic: shared.groupDynamic,
    mostMissed: shared.mostMissed,
    insideJoke: shared.insideJoke,
    hypePersonReason: shared.hypePersonReason,
  }, relationshipType, core);
}

function deriveEnergyReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      netScore: personA.energy.netScore,
      type: personA.energy.type,
      goodNews: personA.energy.goodNews,
      venting: personA.energy.venting,
      hypeQuote: personA.energy.hypeQuote,
    },
    personB: {
      name: personB.name,
      netScore: personB.energy.netScore,
      type: personB.energy.type,
      goodNews: personB.energy.goodNews,
      venting: personB.energy.venting,
      hypeQuote: personB.energy.hypeQuote,
    },
    mostEnergising: shared.mostEnergising,
    mostDraining: shared.mostDraining,
    compatibility: shared.energyCompatibility,
  }, relationshipType, core);
}

function deriveToxicityReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const shared = core?.shared || {};
  const toxicity = shared.toxicity || {};
  const healthScores = toxicity.healthScores?.length
    ? toxicity.healthScores
    : [personA, personB].map(person => ({
        name: person.name,
        score: person.health.score,
        detail: person.health.detail,
      }));

  const apologyLeader = toxicity.apologiesLeader?.name && toxicity.apologiesLeader.name !== "None clearly identified"
    ? toxicity.apologiesLeader
    : (personA.health.apologyCount >= personB.health.apologyCount
        ? { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext }
        : { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext });
  const apologyOther = toxicity.apologiesOther?.name && toxicity.apologiesOther.name !== "None clearly identified"
    ? toxicity.apologiesOther
    : (apologyLeader.name === personA.name
        ? { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext }
        : { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext });

  return attachReportMeta({
    chatHealthScore: toxicity.chatHealthScore,
    healthScores,
    apologiesLeader: apologyLeader,
    apologiesOther: apologyOther,
    redFlagMoments: toxicity.redFlagMoments,
    conflictPattern: toxicity.conflictPattern,
    powerBalance: toxicity.powerBalance,
    powerHolder: toxicity.powerHolder,
    verdict: toxicity.verdict,
  }, relationshipType, core);
}

function deriveLoveLangReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      language: personA.careStyle.language,
      languageEmoji: personA.careStyle.languageEmoji,
      examples: personA.careStyle.examples,
      score: personA.careStyle.score,
    },
    personB: {
      name: personB.name,
      language: personB.careStyle.language,
      languageEmoji: personB.careStyle.languageEmoji,
      examples: personB.careStyle.examples,
      score: personB.careStyle.score,
    },
    mismatch: shared.loveLanguageMismatch,
    mostLovingMoment: shared.mostLovingMoment,
    compatibilityScore: shared.compatibilityScore,
    compatibilityRead: shared.compatibilityRead,
  }, relationshipType, core);
}

function deriveGrowthReportFromCore(core, math, relationshipType) {
  const growth = core?.shared?.growth || {};
  return attachReportMeta({
    thenDepth: growth.thenDepth,
    nowDepth: growth.nowDepth,
    depthChange: growth.depthChange,
    whoChangedMore: growth.whoChangedMore,
    whoChangedHow: growth.whoChangedHow,
    topicsAppeared: growth.topicsAppeared,
    topicsDisappeared: growth.topicsDisappeared,
    trajectory: growth.trajectory,
    trajectoryDetail: growth.trajectoryDetail,
    arcSummary: growth.arcSummary,
  }, relationshipType, core);
}

function deriveAccountaReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const accountability = core?.shared?.accountability || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      total: personA.accountability.total,
      kept: personA.accountability.kept,
      broken: personA.accountability.broken,
      score: personA.accountability.score,
      detail: personA.accountability.detail,
    },
    personB: {
      name: personB.name,
      total: personB.accountability.total,
      kept: personB.accountability.kept,
      broken: personB.accountability.broken,
      score: personB.accountability.score,
      detail: personB.accountability.detail,
    },
    notableBroken: accountability.notableBroken,
    notableKept: accountability.notableKept,
    overallVerdict: accountability.overallVerdict,
  }, relationshipType, core);
}

function hasMeaningfulString(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "—" && text !== "..." && text !== "…");
}

function countMeaningfulStrings(values) {
  return values.filter(hasMeaningfulString).length;
}

function hasMeaningfulAnalysisResult(type, result) {
  if (!result || typeof result !== "object") return false;

  switch (type) {
    case "general":
      return countMeaningfulStrings([
        result.vibeOneLiner,
        result.biggestTopic,
        result.ghostContext,
        result.funniestReason,
        result.dramaContext,
        result.relationshipSummary,
        result.groupDynamic,
        result.tensionMoment,
        result.sweetMoment,
      ]) >= 3;
    case "toxicity":
      return countMeaningfulStrings([
        result.verdict,
        result.conflictPattern,
        result.powerBalance,
        result.apologiesLeader?.context,
        result.apologiesOther?.context,
        ...(result.redFlagMoments || []).flatMap(item => [item?.description, item?.quote]),
        ...(result.healthScores || []).map(item => item?.detail),
      ]) >= 3;
    case "lovelang":
      return countMeaningfulStrings([
        result.personA?.examples,
        result.personB?.examples,
        result.mismatch,
        result.mostLovingMoment,
        result.compatibilityRead,
      ]) >= 2;
    case "growth":
      return countMeaningfulStrings([
        result.thenDepth,
        result.nowDepth,
        result.whoChangedHow,
        result.topicsAppeared,
        result.topicsDisappeared,
        result.trajectoryDetail,
        result.arcSummary,
      ]) >= 3;
    case "accounta":
      return countMeaningfulStrings([
        result.personA?.detail,
        result.personB?.detail,
        result.notableBroken?.promise,
        result.notableKept?.promise,
        result.overallVerdict,
      ]) >= 2;
    case "energy":
      return countMeaningfulStrings([
        result.personA?.goodNews,
        result.personA?.venting,
        result.personB?.goodNews,
        result.personB?.venting,
        result.mostEnergising,
        result.mostDraining,
        result.compatibility,
      ]) >= 3;
    default:
      return false;
  }
}

async function generateCoreAnalysisA(messages, math, relationshipType, chatLang = "en") {
  const chatText = buildSampleText(messages);
  const detectedRel = detectRelationship(messages);
  const relationshipLabel = detectedRel?.detected || null;
  const relationshipLine = detectedRel
    ? `Chat signal analysis detected they address each other as ${detectedRel.detected} (${detectedRel.confidence} confidence). Use "${detectedRel.detected}" when describing their relationship — never substitute "friend", "partner", or any other relationship word unless directly quoting the chat.`
    : `No strong relational address terms were detected in the chat. Use the user-selected type "${relationshipType}" as the relationship label.`;
  const names = math.names || [];
  const isGroup = math.isGroup;
  const personCount = Math.min(names.length || 0, isGroup ? Math.min(names.length || 0, 6) : 2);
  const earlyMsgs = messages.slice(0, Math.min(120, Math.max(40, Math.floor(messages.length * 0.18))));
  const lateMsgs  = messages.slice(Math.max(0, messages.length - Math.min(120, Math.max(40, Math.floor(messages.length * 0.18)))));
  const earlyText = formatForAI(earlyMsgs);
  const lateText  = formatForAI(lateMsgs);
  const fields = `{
  "schemaVersion": ${CORE_ANALYSIS_VERSION},
  "meta": {
    "confidenceNote": "1 sentence — how confident the read is, noting if evidence is mixed or limited",
    "dominantTone": "short phrase naming the dominant overall tone"
  },
  "people": [
    {
      "name": "first person's first name",
      "summaryRole": "1 short phrase describing their role in the dynamic",
      "careStyle": {
        "language": "one of: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed",
        "languageEmoji": "1 emoji representing that care style",
        "examples": "1-2 sentences with concrete examples of how they show care or affection",
        "score": [1-10]
      },
      "energy": {
        "netScore": [1-10],
        "type": "net positive / mixed / net draining",
        "goodNews": "1 sentence — how they bring positive energy, with a real example",
        "venting": "1 sentence — how or how much they vent/drain, or 'minimal venting' if low",
        "hypeQuote": "a short real quote or near-verbatim example of them bringing energy"
      }
    }
  ],
  "shared": {
    "vibeOneLiner": "one punchy sentence capturing the whole chat's energy",
    "biggestTopic": "1 sentence — the biggest recurring topic, very specific not generic",
    "ghostContext": "1 sentence — explain the ghost pattern with real context",
    "funniestPerson": "ONLY the first name of the funniest person, or 'None clearly identified'",
    "funniestReason": "1 short concrete example of the kind of line or moment they drop",
    "dramaStarter": "ONLY a first name, 'Shared', or 'None clearly identified'",
    "dramaContext": "1 sentence — how tension usually gets started, with real evidence",
    "signaturePhrases": ["real phrase or expression person 1 uses a lot", "real phrase or expression person 2 uses a lot"],
    "relationshipStatus": "duo only: short relationship-status label, or 'None clearly identified'",
    "relationshipStatusWhy": "1 sentence — why that status fits, using objective evidence",
    "statusEvidence": "1 short line with a concrete dated example if possible",
    "toxicPerson": "ONLY a first name, 'Tie', or 'None clearly identified'",
    "toxicReason": "1 sentence — factual and conservative explanation of that read",
    "toxicityReport": "2 sentences — balanced, observable summary of tension or health",
    "redFlags": [
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" }
    ],
    "evidenceTimeline": [
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" }
    ],
    "relationshipSummary": "2 sentences — honest read of the duo dynamic",
    "groupDynamic": "2 sentences — honest read of the group dynamic",
    "tensionMoment": "1 sentence — the most tense moment or recurring tension pattern",
    "kindestPerson": "ONLY a first name — the warmest/caring person, or 'None clearly identified'",
    "sweetMoment": "1 sentence — a specific, concrete sweet moment",
    "mostMissed": "group only: ONLY a first name, or 'None clearly identified'",
    "insideJoke": "group only: 1 sentence — recurring joke, meme or reference",
    "hypePersonReason": "group only: 1 sentence — why this person is the group's hype",
    "loveLanguageMismatch": "2 sentences — how their care styles align or mismatch in practice",
    "mostLovingMoment": "1 sentence — the most genuinely warm/loving moment with specific detail",
    "compatibilityScore": [1-10],
    "compatibilityRead": "1 sentence — love-language compatibility summary",
    "mostEnergising": "1 sentence — the most energising moment in the chat",
    "mostDraining": "1 sentence — the most draining moment or pattern, with specific detail",
    "energyCompatibility": "1 sentence — how their energy styles work together (or don't)",
    "growth": {
      "thenDepth": "2 sentences describing the conversation style and topics in the EARLY snapshot",
      "nowDepth": "2 sentences describing the conversation style and topics in the RECENT snapshot",
      "depthChange": "deeper / shallower / about the same",
      "whoChangedMore": "first name of who changed more, or 'Both equally'",
      "whoChangedHow": "1 sentence — specifically how they changed, with evidence",
      "topicsAppeared": "topics or themes that appear in recent messages but were not present early on",
      "topicsDisappeared": "topics or themes from the early messages that seem to have faded away",
      "trajectory": "closer / drifting / stable",
      "trajectoryDetail": "1 sentence — the overall arc based on evidence",
      "arcSummary": "1 punchy sentence capturing the full growth arc"
    }
  }
}`;

  const system = buildAnalystSystemPrompt(
    "a sharp, observant chat analyst building a canonical core-analysis object that later reports will reuse",
    relationshipType,
    `CORE-A SCOPE: relationship dynamic, communication patterns, funny moments, kindness moments, energy, love language, and growth trajectory. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers — each window is a non-contiguous excerpt from the full history. Never connect or combine events from different windows unless the messages themselves explicitly link them. You will also receive EARLY and RECENT contiguous snapshots; use those specifically for growth/change fields, and use the event windows for specific moments and recurring patterns. SPEAKER ATTRIBUTION: Every message line is formatted as [timestamp] SpeakerName: body — the name before the colon is always and only the sender. Assign every quote, action, and behaviour to the name shown on that exact line. Never swap or infer the sender. FUNNY ATTRIBUTION: Whenever you see a laugh reaction (😂, lol, lmao, 'im dead', 💀, 🤣, haha, or similar) from person B immediately following a line from person A, the funny person is person A — the one whose line caused the reaction. Never attribute humour to the person who is laughing. This rule applies everywhere in the chat, regardless of window label. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone, emoji use, or affection level alone — a warm message between cousins does not make them romantic partners, a casual message between partners does not make them friends. Always use the confirmed relationship label when describing who did something to whom. DIRECTION OF ACTIONS: For sweetMoment, kindestPerson, and energy/love-language reads, the actor is the sender of that exact line. For all "name" fields return ONLY the person's first name, with no explanation. Each timestamp already includes the day of week — read it directly and never calculate it yourself. Only report findings you can directly cite from the chat — if evidence is weak, use "None clearly identified". QUOTE RULE: For these fields specifically — sweetMoment, tensionMoment, biggestTopic, dramaContext, toxicityReport, mostLovingMoment, mostEnergising, mostDraining — always try to include a short real quote from the chat inline within the sentence if one exists. Do not translate the quote — reproduce it exactly as written in the chat, in its original language. Format it naturally inside the sentence like: ('exact quote here'). Only skip the quote if no specific line clearly supports the finding. SUMMARY FIELD RULES: vibeOneLiner must capture the dominant emotional tone of the entire chat — never base it on a single moment, window, or exchange. insideJoke must be a recurring reference that appears in multiple windows — if you only saw it once, use 'None clearly identified'. biggestTopic must be the most consistently recurring subject across the full history, not the most dramatic single event. For all three fields: if you cannot confirm recurrence across multiple windows, do not claim it. When quoting messages in any language, quote them as-is — do not translate them. ALL PARTICIPANTS IN THIS CHAT: ${names.slice(0, isGroup ? names.length : 2).join(", ")}. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"} only — one entry per slotted participant. Participants not in the people array may still appear as senders in the windows. Track their behaviour for shared fields (dramaStarter, toxicPerson, funniestPerson, kindestPerson, etc.) but do not create people entries for them. Never fold an unslotted participant's actions into a slotted participant's entry.`,
    chatLang
  );

  const userContent = `Here is a ${isGroup ? "group" : "two-person"} WhatsApp chat between ${names.slice(0, 6).join(", ")}. The full chat has ${math.totalMessages.toLocaleString()} messages. ${math.totalMessages > 10000 ? `This is a very large chat — every summary field (especially vibeOneLiner, biggestTopic, insideJoke) must reflect dominant patterns that recur across the full history. A single window is a tiny fraction of the whole. Never let one moment, joke, or exchange define a summary field. Weight only what appears repeatedly across multiple windows.` : ""} The content below is divided into ISOLATED WINDOWS from across the full history — each labelled ━━━ WINDOW N/N · date · type ━━━. Windows are non-contiguous excerpts; do not infer connections between separate windows. Every line shows the speaker: [timestamp] SpeakerName: body — assign all quotes and actions only to the name on that specific line.

IMPORTANT CONTEXT: ${isGroup ? `The least active member (the ghost) is ${math.ghost}. The conversation starter is ${math.convStarter}.` : `By reply time, ${math.ghostName} is slower to respond. The conversation starter is ${math.convStarter}. Local analysis found that ${math.funniestPerson} caused the most laugh reactions from the other person (${math.laughCausedBy?.[math.funniestPerson] || 0} times) — confirm or correct this based on the chat.`}

EARLY SNAPSHOT (contiguous excerpt from the start of the chat — use ONLY for growth/change fields: thenDepth, nowDepth, depthChange, whoChangedMore, whoChangedHow, topicsAppeared, topicsDisappeared, trajectory, trajectoryDetail, arcSummary):
${earlyText}

RECENT SNAPSHOT (contiguous excerpt from the end of the chat — use ONLY for the same growth/change fields listed above. Do not cite snapshot content for any other field):
${lateText}

EVENT WINDOWS (use these for all non-growth fields — specific moments, quotes, patterns, kindness, humor, tension, red flags, love language, energy):
${chatText}

Return exactly this JSON structure:
${fields}`;

  if (import.meta.env.DEV) console.log("[CoreA] chatLang:", chatLang, "| system prompt tail:", system.slice(-200));
  const raw = await callClaude(system, userContent, CORE_A_MAX_TOKENS);
  return normalizeCoreAnalysisA(raw, math, relationshipType);
}

async function generateCoreAnalysisB(messages, math, relationshipType, chatLang = "en") {
  const chatText = buildSampleText(messages);
  const detectedRel = detectRelationship(messages);
  const relationshipLabel = detectedRel?.detected || null;
  const relationshipLine = detectedRel
    ? `Chat signal analysis detected they address each other as ${detectedRel.detected} (${detectedRel.confidence} confidence). Use "${detectedRel.detected}" when describing their relationship — never substitute "friend", "partner", or any other relationship word unless directly quoting the chat.`
    : `No strong relational address terms were detected in the chat. Use the user-selected type "${relationshipType}" as the relationship label.`;
  const names = math.names || [];
  const personCount = Math.min(names.length || 0, 2);
  const fields = `{
  "schemaVersion": ${CORE_ANALYSIS_VERSION},
  "meta": {
    "confidenceNote": "1 sentence — how confident the risk/accountability read is",
    "dominantTone": "short phrase naming the overall tension level"
  },
  "people": [
    {
      "name": "first person's first name",
      "health": {
        "score": [1-10, this person's contribution to chat health],
        "detail": "1 sentence — specific behaviours driving their health score",
        "apologyCount": [estimated apology count in the sample],
        "apologyContext": "1 sentence — how and when they tend to apologise"
      },
      "accountability": {
        "total": [estimated number of real commitments/promises made],
        "kept": [estimated number kept],
        "broken": [estimated number broken or dropped],
        "score": [1-10],
        "detail": "1 sentence — pattern of how they handle commitments"
      }
    }
  ],
  "shared": {
    "toxicity": {
      "chatHealthScore": [1-10, overall chat health],
      "healthScores": [
        { "name": "first name", "score": [1-10], "detail": "1 sentence — behaviours driving their score" },
        { "name": "first name", "score": [1-10], "detail": "1 sentence — behaviours driving their score" }
      ],
      "apologiesLeader": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 sentence — context and pattern" },
      "apologiesOther": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 sentence — context and pattern" },
      "redFlagMoments": [
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" }
      ],
      "conflictPattern": "2 sentences — how arguments usually start, escalate, and resolve or fail to resolve",
      "powerBalance": "2 sentences — who holds more power in this dynamic and how it shows up",
      "powerHolder": "first name of who holds more power, or 'Balanced'",
      "verdict": "1 punchy sentence verdict on the overall health of this chat"
    },
    "accountability": {
      "notableBroken": {
        "person": "first name or None clearly identified",
        "promise": "what they said they'd do — quote or close paraphrase",
        "date": "approximate date",
        "outcome": "what actually happened, or didn't"
      },
      "notableKept": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to — quote or close paraphrase",
        "date": "approximate date",
        "outcome": "how they followed through"
      },
      "overallVerdict": "1 sentence verdict on accountability in this chat overall"
    }
  }
}`;

  const system = buildAnalystSystemPrompt(
    "a careful risk, conflict, and accountability analyst building the canonical core-b object",
    relationshipType,
    `CORE-B SCOPE: toxicity, health scores, apology patterns, conflict patterns, power balance, red flag moments, and accountability. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers — never connect separate windows unless the messages explicitly link them. SPEAKER ATTRIBUTION: Every line is [timestamp] SpeakerName: body — all behaviour belongs only to the sender on that exact line. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone, emoji use, or affection level alone. Always use the confirmed relationship label when describing who did something to whom. Be conservative: one or two examples do not prove a stable pattern. If the balance is mixed, prefer "Balanced", "Tie", or "None clearly identified" over forcing one villain. For accountability: a promise is BROKEN only if there is clear evidence it was never fulfilled or the person explicitly backed out. A promise fulfilled late is still KEPT. Do not count vague ideas like "we should hang out sometime" as promises. Never combine two separate events into one story. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, with one people entry per participant in that subset.`,
    chatLang
  );

  const userContent = `Here is a WhatsApp chat between ${names.slice(0, 6).join(", ")} (${math.totalMessages.toLocaleString()} messages total). The content below is ISOLATED WINDOWS from across the full history. Do not connect events across windows unless the messages explicitly link them. Every line shows the speaker: [timestamp] SpeakerName: body.

${chatText}

Return exactly this JSON structure:
${fields}`;

  if (import.meta.env.DEV) console.log("[CoreB] chatLang:", chatLang, "| system prompt tail:", system.slice(-200));
  const raw = await callClaude(system, userContent, CORE_B_MAX_TOKENS);
  return normalizeCoreAnalysisB(raw, math, relationshipType);
}

async function aiAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveGeneralReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiToxicityAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveToxicityReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI toxicity failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiLoveLangAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveLoveLangReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI love language failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiGrowthAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveGrowthReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI growth failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiAccountaAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveAccountaReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI accountability failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiEnergyAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveEnergyReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI energy failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

function getCoreAnalysisCacheKey(math, relationshipType, chatLang = "en") {
  return [
    `core-cache-v${CORE_ANALYSIS_CACHE_VERSION}`,
    math?.isGroup ? "group" : "duo",
    relationshipType || "none",
    chatLang || "en",
    math?.totalMessages || 0,
    ...(math?.names || []),
  ].join("::");
}

const REPORT_PIPELINES = {
  general:  { strategy: "core", cache: "a", derive: deriveGeneralReportFromCore },
  toxicity: { strategy: "core", cache: "b", derive: deriveToxicityReportFromCore },
  lovelang: { strategy: "core", cache: "a", derive: deriveLoveLangReportFromCore },
  growth:   { strategy: "core", cache: "a", derive: deriveGrowthReportFromCore },
  accounta: { strategy: "core", cache: "b", derive: deriveAccountaReportFromCore },
  energy:   { strategy: "core", cache: "a", derive: deriveEnergyReportFromCore },
};

const STORED_RESULT_META_KEYS = new Set(["translations", "displayLanguage", "sourceLanguage", "analysisCacheVersion"]);

const REPORT_TRANSLATION_FIELDS = {
  general: [
    "vibeOneLiner",
    "biggestTopic",
    "ghostContext",
    "funniestReason",
    "dramaContext",
    "relationshipStatus",
    "relationshipStatusWhy",
    "statusEvidence",
    "toxicReason",
    "toxicityReport",
    "relationshipSummary",
    "groupDynamic",
    "tensionMoment",
    "sweetMoment",
    "mostMissed",
    "insideJoke",
    "hypePersonReason",
  ],
  toxicity: [
    "apologiesLeader.context",
    "apologiesOther.context",
    "conflictPattern",
    "powerBalance",
    "verdict",
  ],
  lovelang: [
    "personA.examples",
    "personB.examples",
    "mismatch",
    "mostLovingMoment",
    "compatibilityRead",
  ],
  growth: [
    "thenDepth",
    "nowDepth",
    "whoChangedHow",
    "topicsAppeared",
    "topicsDisappeared",
    "trajectoryDetail",
    "arcSummary",
  ],
  accounta: [
    "personA.detail",
    "personB.detail",
    "notableBroken.promise",
    "notableBroken.outcome",
    "notableKept.promise",
    "notableKept.outcome",
    "overallVerdict",
  ],
  energy: [
    "personA.goodNews",
    "personA.venting",
    "personB.goodNews",
    "personB.venting",
    "mostEnergising",
    "mostDraining",
    "compatibility",
  ],
};

const REPORT_TRANSLATION_ARRAY_FIELDS = {
  general: [
    { path: "redFlags", fields: ["title", "detail", "evidence"] },
    { path: "evidenceTimeline", fields: ["title", "detail"] },
  ],
  toxicity: [
    { path: "healthScores", fields: ["detail"] },
    { path: "redFlagMoments", fields: ["description"] },
  ],
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stripStoredResultMeta(result) {
  if (!isPlainObject(result)) return {};
  const next = {};
  Object.entries(result).forEach(([key, value]) => {
    if (!STORED_RESULT_META_KEYS.has(key)) next[key] = value;
  });
  return next;
}

function getStoredResultTranslations(result) {
  return isPlainObject(result?.translations) ? result.translations : {};
}

function getStoredResultDisplayLanguage(result) {
  const code = normalizeUiLangCode(result?.displayLanguage || result?.sourceLanguage || "en");
  return LANG_META[code] ? code : "en";
}

function getByPath(source, path) {
  return path.split(".").reduce((acc, part) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(part)) return acc[Number(part)];
    return acc[part];
  }, source);
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isLeaf = i === parts.length - 1;
    const key = /^\d+$/.test(part) ? Number(part) : part;

    if (isLeaf) {
      cursor[key] = value;
      return target;
    }

    const nextIsIndex = /^\d+$/.test(nextPart || "");
    if (cursor[key] == null) {
      cursor[key] = nextIsIndex ? [] : {};
    }
    cursor = cursor[key];
  }
  return target;
}

function mergeTranslatedResult(base, overlay) {
  if (overlay == null) return base;
  if (typeof overlay !== "object") return overlay;

  if (Array.isArray(overlay)) {
    const source = Array.isArray(base) ? [...base] : [];
    overlay.forEach((item, index) => {
      source[index] = mergeTranslatedResult(source[index], item);
    });
    return source;
  }

  const source = isPlainObject(base) ? { ...base } : {};
  Object.entries(overlay).forEach(([key, value]) => {
    source[key] = mergeTranslatedResult(source[key], value);
  });
  return source;
}

function buildStoredResultData(baseResult, displayLanguage = "en", translationOverlay = null) {
  const canonical = stripStoredResultMeta(baseResult);
  const lang = normalizeUiLangCode(displayLanguage);
  const translations = {};
  if (lang !== "en" && isPlainObject(translationOverlay) && Object.keys(translationOverlay).length) {
    translations[lang] = translationOverlay;
  }
  return {
    ...canonical,
    sourceLanguage: "en",
    displayLanguage: lang,
    analysisCacheVersion: CORE_ANALYSIS_CACHE_VERSION,
    translations,
  };
}

function getDisplayResultData(result, preferredLanguage = null) {
  const canonical = stripStoredResultMeta(result);
  const translations = getStoredResultTranslations(result);
  const lang = normalizeUiLangCode(preferredLanguage || getStoredResultDisplayLanguage(result));
  const overlay = isPlainObject(translations[lang]) ? translations[lang] : null;
  return {
    ...mergeTranslatedResult(canonical, overlay),
    sourceLanguage: "en",
    displayLanguage: overlay ? lang : "en",
    translations,
  };
}

function pushTranslationEntry(entries, path, value) {
  const text = strOr(value);
  if (!text) return;
  entries.push({ path, text });
}

function collectResultTranslationEntries(reportType, result) {
  const canonical = stripStoredResultMeta(result);
  const entries = [];

  (REPORT_TRANSLATION_FIELDS[reportType] || []).forEach(path => {
    pushTranslationEntry(entries, path, getByPath(canonical, path));
  });

  (REPORT_TRANSLATION_ARRAY_FIELDS[reportType] || []).forEach(({ path, fields }) => {
    const list = getByPath(canonical, path);
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      fields.forEach(field => pushTranslationEntry(entries, `${path}.${index}.${field}`, item?.[field]));
    });
  });

  return entries;
}

function normalizeTranslatedEntries(raw, sourceEntries) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const fallbackByPath = Object.fromEntries(sourceEntries.map(item => [item.path, item.text]));
  return items.map(item => {
    const path = strOr(item?.path);
    if (!path || !(path in fallbackByPath)) return null;
    const text = strOr(item?.text, fallbackByPath[path]);
    return { path, text };
  }).filter(Boolean);
}

function buildTranslationOverlay(entries) {
  return entries.reduce((overlay, item) => setByPath(overlay, item.path, item.text), {});
}

async function translateResultOverlay(reportType, result, targetLang = "en") {
  const lang = normalizeUiLangCode(targetLang);
  if (!LANG_META[lang] || lang === "en") return null;

  const sourceEntries = collectResultTranslationEntries(reportType, result);
  if (!sourceEntries.length) return null;

  const system = [
    "You translate saved WrapChat report text into the target language.",
    "Return only valid JSON in the exact schema requested.",
    "Keep every path value mapped to the same path.",
    "Translate natural-language explanations into the target language.",
    "Preserve names exactly as written.",
    "If a value contains a direct quote from the chat, keep the quote itself as-is and only translate the surrounding explanation if needed.",
  ].join(" ");

  const userContent = `Target language: ${LANG_META[lang]} (${lang})

Translate the following WrapChat report text fields into ${LANG_META[lang]}. Keep every "path" exactly the same. Return exactly this JSON shape:
{
  "items": [
    { "path": "field.path", "text": "translated text" }
  ]
}

Source items:
${JSON.stringify(sourceEntries, null, 2)}`;

  const raw = await callClaude(system, userContent, 1800, "json");
  const translatedEntries = normalizeTranslatedEntries(raw, sourceEntries);
  if (!translatedEntries.length) return null;
  return buildTranslationOverlay(translatedEntries);
}

// ─────────────────────────────────────────────────────────────────
// UI PRIMITIVES  — bold rounded-card aesthetic
// ─────────────────────────────────────────────────────────────────

// Category accent colors — used for inner cards
const PAL = {
  roast:    { bg:"#B83A10", inner:"#E8592A", text:"#fff", accent:"#FF8B6A" },
  lovely:   { bg:"#7A1C48", inner:"#A02860", text:"#fff", accent:"#F08EBF" },
  funny:    { bg:"#4A6A04", inner:"#6E9A08", text:"#fff", accent:"#C8F06A" },
  stats:    { bg:"#083870", inner:"#0E5AAA", text:"#fff", accent:"#6AB4F0" },
  ai:       { bg:"#1A3060", inner:"#2A4A90", text:"#fff", accent:"#8AACF0" },
  finale:   { bg:"#5E1228", inner:"#8A1C3C", text:"#fff", accent:"#F08EBF" },
  upload:   { bg:"#2C1268", inner:"#4A1EA0", text:"#fff", accent:"#A08AF0" },
  toxicity: { bg:"#3D0A0A", inner:"#8B1A1A", text:"#fff", accent:"#E04040" },
  lovelang: { bg:"#3D1A2E", inner:"#8B3A5A", text:"#fff", accent:"#F08EBF" },
  growth:   { bg:"#0A2E2E", inner:"#1A6B5A", text:"#fff", accent:"#3AF0C0" },
  accounta: { bg:"#0A1A3D", inner:"#1A3A8B", text:"#fff", accent:"#6AB4F0" },
  energy:   { bg:"#2E1A0A", inner:"#8B5A1A", text:"#fff", accent:"#F0A040" },
};

const PILL_LABEL = {
  roast:"The Roast", lovely:"The Lovely", funny:"The Funny", stats:"The Stats", ai:"Insight", finale:"WrapChat",
  toxicity:"Toxicity Report", lovelang:"Love Language", growth:"Growth Report", accounta:"Accountability", energy:"Energy Report",
};



function canShareFiles(files) {
  if (!navigator?.share || !files?.length) return false;
  if (!navigator.canShare) return true;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't create share image."));
    }, "image/png");
  });
}

function SharePicker({ open, busy, onCard, onSummary, onClose }) {
  if (!open) return null;
  const btnStyle = {
    flex: 1,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    padding: "20px 0",
    color: "#fff",
    cursor: busy ? "wait" : "pointer",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  };
  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={onClose}
    >
      <div
        style={{ width:"min(420px,100%)", background:"#111118", border:"1px solid rgba(255,255,255,0.10)", borderRadius:"28px 28px 0 0", padding:"10px 20px 32px", boxShadow:"0 -20px 60px rgba(0,0,0,0.5)", color:"#fff" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width:36, height:4, borderRadius:999, background:"rgba(255,255,255,0.14)", margin:"0 auto 20px" }} />
        <div style={{ fontSize:18, fontWeight:800, letterSpacing:-0.5, marginBottom:16 }}>Share</div>
        <div style={{ display:"flex", gap:12 }}>
          <button className="wc-btn" onClick={onCard} disabled={busy} style={btnStyle}>
            <span style={{ fontSize:26 }}>🃏</span>
            <span style={{ fontSize:14, fontWeight:700 }}>{busy ? "Saving…" : "Card"}</span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Current screen</span>
          </button>
          <button className="wc-btn" onClick={onSummary} disabled={busy} style={btnStyle}>
            <span style={{ fontSize:26 }}>📋</span>
            <span style={{ fontSize:14, fontWeight:700 }}>{busy ? "Saving…" : "Summary"}</span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Results overview</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Converts AI health score (1–10, higher = healthier) to a display label.
// Prefer this over local math toxicityLevel whenever AI data is available.
function chatHealthLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return n >= 7 ? "Healthy" : n >= 4 ? "Tense" : "Heated";
}

// ─────────────────────────────────────────────────────────────────
// REPORT TYPES — shown on the report selection screen
// ─────────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { id:"general",  label:"General Wrapped",       desc:"The full Wrapped-style deep dive — stats, AI insights, and your chat personality.",         palette:"upload"   },
  { id:"toxicity", label:"Toxicity Report",        desc:"Red flags, power imbalances, who apologises more, conflict patterns, health scores.",        palette:"toxicity" },
  { id:"lovelang", label:"Love Language Report",   desc:"How each person shows affection, mapped to the 5 love languages. Works for friends too.",   palette:"lovelang" },
  { id:"growth",   label:"Growth Report",          desc:"First 3 months vs last 3 months — are you growing together or drifting apart?",             palette:"growth"   },
  { id:"accounta", label:"Accountability Report",  desc:"Promises made in the chat and whether they were followed through. Receipts for both.",       palette:"accounta" },
  { id:"energy",   label:"Energy Report",          desc:"Who brings good energy vs drains it — net energy score per person.",                         palette:"energy"   },
];

const LEGAL_VERSION = "1.1";

// ─── Legal document text — rendered inline, no external links ───
// Replace the placeholder strings below with the full text from your PDFs.
const TERMS_OF_SERVICE_TEXT = `TERMS OF SERVICE
Version 1.1 — Last updated 2025

PLEASE READ THESE TERMS CAREFULLY BEFORE USING WRAPCHAT.

1. ACCEPTANCE OF TERMS
By accessing or using WrapChat ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

2. DESCRIPTION OF SERVICE
WrapChat is a chat analysis tool that processes WhatsApp chat exports you provide. The Service uses AI to generate reports about communication patterns, relationship dynamics, and related insights from the text you upload.

3. ELIGIBILITY
You must be at least 18 years old to use the Service. By using the Service, you represent that you are at least 18 years of age.

4. YOUR CONTENT
You retain ownership of any chat data you upload. By uploading a chat export, you grant WrapChat a limited licence to process that data for the sole purpose of generating your requested reports. Chat content is analysed in transit and is not stored on our servers beyond what is necessary to produce your results.

5. CONSENT AND THIRD PARTIES
You are responsible for ensuring you have the right to upload any conversation. You should only upload chats in which you are a participant. You must not upload chats belonging to other people without their knowledge and consent. WrapChat is not responsible for any claims arising from your use of third-party data.

6. PROHIBITED USES
You agree not to use the Service to:
- Upload content belonging to others without consent
- Circumvent security or access controls
- Reverse-engineer, copy, or reproduce any part of the Service
- Use the Service for any unlawful purpose
- Attempt to gain unauthorised access to any system or network

7. INTELLECTUAL PROPERTY
All intellectual property rights in the Service, including but not limited to its software, design, and methodology, are owned by WrapChat. Nothing in these Terms grants you any rights in the Service other than the right to use it as expressly set out herein.

8. DISCLAIMER OF WARRANTIES
The Service is provided "as is" and "as available" without any warranties of any kind, express or implied. WrapChat does not warrant that the Service will be uninterrupted, error-free, or that any results generated will be accurate, complete, or reliable.

9. LIMITATION OF LIABILITY
To the maximum extent permitted by applicable law, WrapChat shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Service.

10. CHANGES TO TERMS
WrapChat reserves the right to modify these Terms at any time. Continued use of the Service after changes are posted constitutes your acceptance of the revised Terms. Material changes will require explicit re-acceptance.

11. GOVERNING LAW
These Terms shall be governed by and construed in accordance with applicable law. Any disputes shall be resolved through binding arbitration or in the courts of the applicable jurisdiction.

12. CONTACT
For questions about these Terms, contact us at support@wrapchat.app.

By accepting these Terms, you confirm you have read and understood them in full.`;

const PRIVACY_POLICY_TEXT = `PRIVACY POLICY
Version 1.1 — Last updated 2025

This Privacy Policy explains how WrapChat ("we", "us", "our") collects, uses, and protects your information when you use our Service.

1. INFORMATION WE COLLECT

Account Information
When you create an account, we collect your email address and a hashed version of your password. We do not collect your real name unless you voluntarily provide it.

Chat Data
You upload WhatsApp chat exports to generate reports. These chat exports contain messages written by you and other participants. Chat content is transmitted securely and processed solely to generate your requested analysis. Chat text is not stored on our servers after processing is complete.

Usage Data
We may collect anonymised information about how you use the Service, including which report types you generate and general usage patterns. This data cannot be used to identify you and is used only to improve the Service.

Results Data
The reports generated from your analysis (not the underlying chat text) may be stored on your account so you can access them later. You can delete your saved results at any time.

2. HOW WE USE YOUR INFORMATION

We use your information to:
- Provide and operate the Service
- Generate the analysis reports you request
- Maintain and improve the Service
- Communicate with you about your account
- Comply with legal obligations

We do not sell, rent, or share your personal information with third parties for marketing purposes.

3. AI PROCESSING
Your chat content is processed by AI models to generate insights. Excerpts of your chat may be sent to a third-party AI provider (Anthropic) as part of this processing. Anthropic's use of this data is governed by their API usage policies and privacy practices. Chat content processed through the AI pipeline is not used to train AI models under our current agreements.

4. DATA RETENTION
Account data is retained while your account is active. Processed chat content is not retained after your report is generated. Saved report results are retained until you delete them or close your account.

5. DATA SECURITY
We implement industry-standard security measures to protect your data, including encryption in transit (TLS) and at rest. No method of transmission over the internet is 100% secure. We cannot guarantee absolute security but will notify you promptly in the event of a breach affecting your data.

6. YOUR RIGHTS
Depending on your location, you may have rights including:
- Access to the personal data we hold about you
- Correction of inaccurate data
- Deletion of your account and associated data
- Portability of your data in a machine-readable format
- Withdrawal of consent at any time

To exercise these rights, contact us at privacy@wrapchat.app.

7. COOKIES AND TRACKING
The Service uses essential cookies required for authentication and session management. We do not use tracking or advertising cookies.

8. CHILDREN'S PRIVACY
The Service is not directed to individuals under 18. We do not knowingly collect personal information from anyone under 18. If you believe we have inadvertently collected such information, contact us immediately.

9. CHANGES TO THIS POLICY
We may update this Privacy Policy periodically. We will notify you of material changes by requiring re-acceptance within the app. The version number and date at the top of this document will always reflect the most recent update.

10. CONTACT
For privacy-related questions or to exercise your rights:
Email: privacy@wrapchat.app

By accepting this Privacy Policy, you confirm you have read and understood it in full.`;

const SLIDE_MS   = 480;
const SLIDE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

function Shell({ sec, prog, total, children, feedback=null }) {
  const p = PAL[sec] || PAL.upload;
  const onClose = useContext(CloseResultsContext);
  const share = useContext(ShareResultsContext);
  const feedbackApi = useContext(FeedbackContext);
  const { dir, id } = useContext(SlideContext);
  const t = useT();

  // Content-only slide animation — chrome (bg, bar, pill, X) stays perfectly still.
  const prevContentRef = useRef(null);
  const prevIdRef      = useRef(id);
  const [exitContent, setExitContent] = useState(null);

  useLayoutEffect(() => {
    if (id !== prevIdRef.current) {
      setExitContent({ node: prevContentRef.current, dir });
      prevIdRef.current = id;
      const t = setTimeout(() => setExitContent(null), SLIDE_MS);
      return () => clearTimeout(t);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  prevContentRef.current = children;

  const enterFrom = dir === "fwd" ? "100%"  : "-100%";
  const exitTo    = dir === "fwd" ? "-100%" : "100%";

  return (
    <>
      <style>{`
        .wc-root * { box-sizing: border-box; }
        @keyframes blink { 0%,80%,100%{opacity:.15} 40%{opacity:1} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .wc-fadeup   { animation: fadeUp 0.4s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-2 { animation: fadeUp 0.4s 0.07s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-3 { animation: fadeUp 0.4s 0.14s cubic-bezier(.2,0,.1,1) both; }
        .wc-btn:hover { opacity:0.82; transform:scale(0.98); }
        @media (max-width: 430px) { .wc-root { border-radius: 0 !important; } }
        @keyframes wcContentIn {
          from { transform: translateX(var(--wc-enter-from)); }
          to   { transform: translateX(0); }
        }
      `}</style>
      <div className="wc-root" style={{
        width: "min(420px, 100vw)",
        minHeight: "100svh",
        margin: "0 auto",
        background: p.bg,
        transition: `background ${SLIDE_MS}ms ${SLIDE_EASE}`,
        borderRadius: 32,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div style={{
          position: "absolute",
          left: 12,
          bottom: 10,
          zIndex: 12,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.28)",
          pointerEvents: "none",
          textTransform: "uppercase",
        }}>
          build {APP_BUILD_ID}
        </div>
        {/* ── STATIC CHROME — never moves ── */}
        {/* Thin progress bar at very top */}
        <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"rgba(255,255,255,0.12)", zIndex:5 }}>
          <div style={{ height:"100%", background:"rgba(255,255,255,0.75)", borderRadius:"0 2px 2px 0", width:`${total>0?Math.round((prog/total)*100):0}%`, transition:"width 0.4s" }} />
        </div>
        {share?.onShare && (
          <button
            onClick={share.onShare}
            className="wc-btn"
            aria-label={t("Share")}
            disabled={share.busy}
            style={{
              position:"absolute",
              top:14, left:14,
              minWidth:66, height:30,
              borderRadius:999,
              border:"none",
              background:"rgba(255,255,255,0.12)",
              color:"#fff",
              fontSize:12, lineHeight:1,
              cursor:share.busy ? "wait" : "pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              zIndex:10,
              padding:"0 12px",
              transition:"all 0.15s",
              fontWeight:700,
              letterSpacing:"0.04em",
              opacity:share.busy ? 0.7 : 1,
            }}
          >
            {share.busy ? "Saving…" : t("Share")}
          </button>
        )}
        {feedback?.resultId && feedbackApi?.openFeedback && (
          <div style={{ position:"absolute", top:14, right:onClose ? 54 : 14, zIndex:11 }}>
            <FeedbackButton onClick={() => feedbackApi.openFeedback(feedback)} />
          </div>
        )}
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="wc-btn"
            aria-label="Close results"
            style={{
              position: "absolute",
              top: 14, right: 14,
              width: 30, height: 30,
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 15, lineHeight: 1,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 10, padding: 0,
              transition: "all 0.15s",
            }}
          >✕</button>
        )}
        {/* Pill label */}
        {PILL_LABEL[sec] && (
          <div style={{ paddingTop:18, display:"flex", justifyContent:"center", position:"relative", zIndex:4 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", background:"rgba(255,255,255,0.12)", padding:"5px 14px", borderRadius:20 }}>
              {t(PILL_LABEL[sec])}
            </div>
          </div>
        )}

        {/* ── SLIDING CONTENT AREA ── */}
        <div style={{ flex:1, minHeight:0, position:"relative", overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {/* Outgoing content */}
          {exitContent && (
            <div className="wc-pane" style={{
              position:"absolute", inset:0,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              padding:"16px 20px calc(24px + env(safe-area-inset-bottom, 0px))", gap:10,
              transform:`translateX(${exitTo})`,
              transition:`transform ${SLIDE_MS}ms ${SLIDE_EASE}`,
              willChange:"transform",
              pointerEvents:"none",
              overflowY:"auto",
            }}>
              {exitContent.node}
            </div>
          )}
          {/* Incoming content */}
          <div className="wc-pane" style={{
            position: exitContent ? "absolute" : "relative",
            inset: exitContent ? 0 : "auto",
            flex: exitContent ? "none" : 1,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            width:"100%",
            minHeight:0,
            padding:"16px 20px calc(24px + env(safe-area-inset-bottom, 0px))", gap:10,
            animation: exitContent ? `wcContentIn ${SLIDE_MS}ms ${SLIDE_EASE} both` : "none",
            ["--wc-enter-from"]: enterFrom,
            willChange: exitContent ? "transform" : "auto",
            overflowY:"auto",
            overscrollBehavior:"contain",
          }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

// Typography — system font, same weights as before
const T   = ({s=26,children}) => (
  <div className="wc-fadeup" style={{ fontSize:s, fontWeight:800, textAlign:"center", lineHeight:1.2, color:"#fff", letterSpacing:-0.5, width:"100%", marginBottom:4 }}>{children}</div>
);
const Big = ({children}) => (
  <div className="wc-fadeup-2" style={{ fontSize:44, fontWeight:800, textAlign:"center", color:"#fff", letterSpacing:-1.5, width:"100%", lineHeight:1.05, wordBreak:"break-word", margin:"6px 0 2px" }}>{children}</div>
);
const Sub = ({children, mt=6}) => (
  <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.65)", lineHeight:1.6, width:"100%", marginTop:mt, fontWeight:400 }}>{children}</div>
);

// Inner card — the chunky rounded inner panel from the reference
function Card({ children, accent, style={} }) {
  const p = accent || PAL.upload;
  const bg = typeof p === "string" ? p : p.inner;
  return (
    <div className="wc-fadeup-2" style={{ width:"100%", background:bg, borderRadius:24, padding:"16px 18px", ...style }}>
      {children}
    </div>
  );
}
const stableHash = (value) => {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash * 31) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

// Deterministic pick — stable across rerenders, sharing, and reopening saved reports.
const pick = (arr, key = "") => {
  if (!Array.isArray(arr) || !arr.length) return "";
  const idx = stableHash(`${key}::${arr.join("\u241E")}`) % arr.length;
  return arr[idx];
};

const Quip = ({children}) => <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.8)", background:"rgba(255,255,255,0.1)", padding:"12px 18px", borderRadius:18, width:"100%", lineHeight:1.55, fontStyle:"italic", fontWeight:500 }}>{children}</div>;

function Dots() {
  return (
    <div style={{ display:"flex", gap:6, padding:"4px 0" }}>
      {[0,1,2].map(i=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,0.4)",animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
    </div>
  );
}

function AICard({ label, value, loading }) {
  return (
    <div className="wc-fadeup-2" style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 18px", width:"100%" }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:8 }}>{label}</div>
      {loading ? <Dots /> : <div style={{ fontSize:15, color:"#fff", lineHeight:1.65, fontWeight:400 }}>{value||"—"}</div>}
    </div>
  );
}

function FeedbackButton({ onClick }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="wc-btn"
      aria-label={t("What's off about this?")}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.5)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: "all 0.15s",
      }}
    >
      {/* flag icon */}
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ display:"block" }}>
        <path d="M4 21V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <path d="M4 4h11l-3 5 3 5H4" fill="rgba(255,255,255,0.15)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function FeedbackSheet({ open, target, selected, note, submitting, onSelect, onNoteChange, onSubmit, onClose }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open && target) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open, target]);

  if (!open || !target) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: `rgba(0,0,0,${visible ? 0.6 : 0})`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        transition: "background 0.28s ease",
        justifyContent: "center",
        padding: "0 0 env(safe-area-inset-bottom, 0px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(420px, 100vw)",
          display: "flex",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            width: "calc(100% - 12px)",
            maxHeight: "min(72svh, 560px)",
            background: "linear-gradient(180deg, #15151d 0%, #101017 100%)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "28px 28px 0 0",
            padding: "10px 14px calc(16px + env(safe-area-inset-bottom, 0px))",
            boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
            color: "#fff",
            overflowY: "auto",
            transform: visible ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            scrollbarWidth: "thin",
            boxSizing: "border-box",
          }}
        >
          {/* drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.14)", margin: "0 auto 16px" }} />

          {/* header */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5, marginBottom: 5, lineHeight: 1.2 }}>{t("What's off about this?")}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              {target.reportType} · card {target.cardIndex}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontWeight: 600, lineHeight: 1.45, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "10px 12px" }}>
              {target.cardTitle}
            </div>
          </div>

          {/* options */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 14 }}>
            {FEEDBACK_OPTIONS.map(option => {
              const active = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSelect(option)}
                  className="wc-btn"
                  style={{
                    minHeight: 42,
                    border: `1px solid ${active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.10)"}`,
                    borderRadius: 16,
                    padding: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.25,
                    fontWeight: 700,
                    cursor: "pointer",
                  transition: "all 0.15s",
                  background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)",
                  color: active ? "#fff" : "rgba(255,255,255,0.72)",
                  textAlign: "center",
                  boxSizing: "border-box",
                }}
              >
                {t(option)}
              </button>
              );
            })}
          </div>

          {/* optional note */}
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder={t("Optional note")}
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: "12px 14px",
              fontSize: 14,
              lineHeight: 1.45,
              color: "#fff",
              outline: "none",
              fontFamily: "inherit",
              marginBottom: 14,
              boxSizing: "border-box",
            }}
          />

          {/* actions */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              className="wc-btn"
              style={{
                minHeight: 46,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.68)",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                padding: "12px 10px",
                borderRadius: 16,
                transition: "all 0.15s",
                boxSizing: "border-box",
              }}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              className="wc-btn"
              disabled={!selected || submitting}
              style={{
                minHeight: 46,
                padding: "12px 10px",
                borderRadius: 16,
                border: "none",
                background: !selected || submitting ? "rgba(255,255,255,0.08)" : PAL.upload.inner,
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
                cursor: !selected || submitting ? "default" : "pointer",
                opacity: !selected || submitting ? 0.45 : 1,
                transition: "all 0.15s",
                letterSpacing: 0.1,
                boxSizing: "border-box",
              }}
            >
              {submitting ? t("Sending…") : t("Submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, children }) {
  return <button onClick={onClick} className="wc-btn" style={{ padding:"12px 28px", borderRadius:50, border:"none", background:"rgba(255,255,255,0.15)", color:"#fff", fontSize:15, cursor:"pointer", fontWeight:700, transition:"all 0.15s", flexShrink:0, letterSpacing:0.2 }}>{children}</button>;
}
function Nav({ back, next, showBack=true, nextLabel="Next" }) {
  const t = useT();
  return (
    <div style={{ display:"flex", gap:10, marginTop:8, width:"100%", justifyContent:"center" }}>
      {showBack && <Btn onClick={back}>{t("Back")}</Btn>}
      <Btn onClick={next}>{t(nextLabel)}</Btn>
    </div>
  );
}
function Bar({ value, max, color, label, delay=0 }) {
  const [w,setW]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setW(Math.round((value/Math.max(max,1))*100)),120+delay);return()=>clearTimeout(t);},[value,max,delay]);
  const lbl = (label||"").split(" ")[0].slice(0,10);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, width:"100%" }}>
      <div style={{ width:58, textAlign:"right", fontSize:13, color:"rgba(255,255,255,0.65)", flexShrink:0, fontWeight:600 }}>{lbl}</div>
      <div style={{ flex:1, minWidth:0, height:32, borderRadius:50, background:"rgba(0,0,0,0.2)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${w}%`, minWidth:w>0?"52px":"0", background:color, borderRadius:50, display:"flex", alignItems:"center", paddingLeft:12, fontSize:13, fontWeight:700, color:"#fff", transition:"width 0.9s cubic-bezier(.4,0,.2,1)", whiteSpace:"nowrap" }}>{value.toLocaleString()}</div>
      </div>
    </div>
  );
}
function MonthBadge({ month, count, medal }) {
  const t = useT();
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center", flex:1, minWidth:80 }}>
      <div style={{ fontSize:26 }}>{medal}</div>
      <div className="" style={{ fontSize:15, fontWeight:800, color:"#fff", marginTop:8, letterSpacing:-0.3 }}>{month}</div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4, fontWeight:500 }}>{count.toLocaleString()} {t("msgs")}</div>
    </div>
  );
}
function Words({ words }) {
  const M=["🥇","🥈","🥉"];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:4 }}>
      {words.map(([w,c],i)=>(
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background: i<3 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)", borderRadius:14 }}>
          <span style={{ width:26, fontSize:14, flexShrink:0 }}>{M[i]||i+1}</span>
          <span style={{ flex:1, fontWeight:700, color:"#fff", fontSize:15, letterSpacing:-0.2 }}>{w}</span>
          <span style={{ fontSize:13, color:"rgba(255,255,255,0.55)", fontWeight:600 }}>{c.toLocaleString()}x</span>
        </div>
      ))}
    </div>
  );
}
function Cell({ label, value }) {
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px" }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:6 }}>{label}</div>
      <div className="" style={{ fontWeight:800, color:"#fff", fontSize:16, wordBreak:"break-word", letterSpacing:-0.3 }}>{value}</div>
    </div>
  );
}
function FlagList({ flags, loading }) {
  const t = useT();
  const items = normalizeRedFlags(flags);
  if (loading && !items.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {items.map((flag, index) => (
        <div key={`${flag.title}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {t("Red flag {index}", { index: index + 1 })}
          </div>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, marginBottom:6 }}>
            {flag.title}
          </div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.78)", lineHeight:1.6 }}>
            {flag.detail || t("This pattern showed up enough to feel worth watching.")}
          </div>
          {flag.evidence && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", lineHeight:1.5, marginTop:8 }}>
              {t("Evidence")}: {flag.evidence}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EvidenceList({ items, loading }) {
  const entries = normalizeTimeline(items);
  if (loading && !entries.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {entries.map((item, index) => (
        <div key={`${item.date}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {item.date}
          </div>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.25, marginBottom:6 }}>
            {item.title}
          </div>
          {item.detail && (
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.6 }}>
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TextList({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      {items.map((item, index) => (
        <div key={`${item}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", color:"rgba(255,255,255,0.78)", textAlign:"left", fontSize:13, lineHeight:1.55 }}>
          {item}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DUO SCREENS
// ─────────────────────────────────────────────────────────────────
function DuoScreen({ s, ai, aiLoading, step, back, next, mode, relationshipType, resultId }) {
  const t = useT();
  const total  = s.msgCounts[0]+s.msgCounts[1];
  const pct0   = Math.round((s.msgCounts[0]/total)*100);
  const mMax   = Math.max(...s.msgCounts);
  const nov    = s.avgMsgLen[0]>=s.avgMsgLen[1]?0:1;
  const TOTAL  = mode === "redflags" ? DUO_REDFLAG_SCREENS : DUO_CASUAL_SCREENS;
  const reportKey = mode === "redflags" ? "toxicity" : "general";
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: reportKey, cardIndex, cardTitle } : null
  );
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || (aiLoading ? "..." : s.names[0]);
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const relationshipStatus = ai?.relationshipStatus || s.relationshipStatus || (aiLoading ? "..." : "Complicated");
  const relationshipStatusWhy = ai?.relationshipStatusWhy || s.relationshipStatusWhy;
  const statusEvidence = ai?.statusEvidence || s.statusEvidence;
  const duoFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = chatHealthLabel(ai?.chatHealthScore) || s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL} feedback={feedback("Who's more obsessed?", 1)}>
      <T>{t("Who's more obsessed?")}</T>
      <div style={{width:"100%",marginTop:16}}>
        <Bar value={s.msgCounts[0]} max={mMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.msgCounts[1]} max={mMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Sub mt={14}>{t("{pct}% of all messages came from {name}.", { pct: pct0, name: s.names[0] })}</Sub>
      {(() => {
      const name = s.names[pct0>=50?0:1];
      const q = pick(t("quips.duo.obsessed", { name }), `duo-obsessed|${s.names.join("|")}|${s.totalMessages}|${name}|${pct0}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL} feedback={feedback("The Ghost Award", 2, !s.ghostEqual)}>
      {s.ghostEqual ? (
        <>
          <T>{t("Response times")}</T>
          <Big>{t("Balanced")}</Big>
          <Sub>{t("{name} avg reply:", { name: s.names[0] })} <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{t("{name} avg reply:", { name: s.names[1] })} <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          {(() => { const q = pick(t("quips.duo.responseBalanced"), `duo-response-balanced|${s.names.join("|")}|${s.totalMessages}|${s.ghostAvg.join("|")}`); return <Quip>{q}</Quip>; })()}
        </>
      ) : (
        <>
          <T>{t("The Ghost Award")}</T>
          <Big>{s.ghostName}</Big>
          <Sub>{t("{name} avg reply:", { name: s.names[0] })} <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{t("{name} avg reply:", { name: s.names[1] })} <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          <AICard label={t("What's really going on")} value={ai?.ghostContext} loading={aiLoading} />
          {(() => { const q = pick(t("quips.duo.ghost", { name: s.ghostName }), `duo-ghost|${s.names.join("|")}|${s.totalMessages}|${s.ghostName}|${s.ghostAvg.join("|")}`); return <Quip>{q}</Quip>; })()}
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("The Last Word", 3)}>
      <T>{t("The Last Word")}</T>
      <Big>{s.convKiller}</Big>
      <Sub>{t("Sends the last message that nobody replies to — {count} times.", { count: s.convKillerCount })}</Sub>
      {(() => {
      const q = pick(t("quips.duo.lastWord", { name: s.convKiller }), `duo-last-word|${s.names.join("|")}|${s.totalMessages}|${s.convKiller}|${s.convKillerCount}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL} feedback={feedback("Your longest streak", 4)}>
      <T>{t("Your longest streak")}</T>
      <Big>{t("{count} days", { count: s.streak })}</Big>
      <Sub>{t("Texted every single day for {count} days straight.", { count: s.streak })}</Sub>
      {(() => {
        const q = s.streak >= 100
          ? pick(t("quips.duo.streak100", { streak: s.streak }), `duo-streak100|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
          : s.streak >= 30
            ? pick(t("quips.duo.streak30", { streak: s.streak }), `duo-streak30|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
            : s.streak >= 10
              ? pick(t("quips.duo.streak10", { streak: s.streak }), `duo-streak10|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
              : pick(t("quips.duo.streakShort", { streak: s.streak }), `duo-streak-short|${s.names.join("|")}|${s.totalMessages}|${s.streak}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL} feedback={feedback("The Kindest One", 5)}>
      <T>{t("The Kindest One")}</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "—")}</Big>
      <AICard label={t("The sweetest moment")} value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL} feedback={feedback("Top 3 most active months", 7)}>
      <T>{t("Top 3 most active months")}</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{t("{month} was your month. Something was going on.", { month: s.topMonths[0][0] })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL} feedback={feedback("Who always reaches out first?", 6)}>
      <T>{t("Who always reaches out first?")}</T>
      <Big>{s.convStarter}</Big>
      <Sub>{t("Started {pct} of all conversations.", { pct: s.convStarterPct })}</Sub>
      {(() => {
      const q = pick(t("quips.duo.convStarter", { name: s.convStarter }), `duo-conv-starter|${s.names.join("|")}|${s.totalMessages}|${s.convStarter}|${s.convStarterPct}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL} feedback={feedback("The Funny One", 8)}>
      <T>{t("The Funny One")}</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label={t("Drops lines like")} value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL} feedback={feedback("Spirit emojis", 9)}>
      <T>{t("Spirit emojis")}</T>
      <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:64,lineHeight:1}}>{s.spiritEmoji[i]}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginTop:8}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>{t("These two emojis basically ARE this chat.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL} feedback={feedback("Top 10 most used words", 10)}>
      <T>{t("Top 10 most used words")}</T>
      <Words words={s.topWords} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={11} total={TOTAL} feedback={feedback("Signature phrases", 11)}>
      <T>{t("Signature phrases")}</T>
      <div style={{display:"flex",gap:"1rem",marginTop:16,width:"100%",justifyContent:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{background:"rgba(255,255,255,0.08)",padding:"14px 18px",borderRadius:12,textAlign:"center",flex:1}}>
            {aiLoading?<Dots />:<div style={{fontSize:14,fontWeight:700,color:"#fff",fontStyle:"italic"}}>"{ai?.signaturePhrase?.[i]||s.signatureWord[i]}"</div>}
            <div style={{fontSize:12,color:"rgba(255,255,255,0.42)",marginTop:6}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>{t("The phrases that define each of you.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL} feedback={feedback("Message length", 12)}>
      {(() => {
        const diff = Math.abs(s.avgMsgLen[0] - s.avgMsgLen[1]);
        const ratio = Math.max(...s.avgMsgLen) / Math.max(Math.min(...s.avgMsgLen), 1);
        const isSimilar = diff < 15 || ratio < 1.3;
        const novelist = s.names[nov];
        const texter   = s.names[nov===0?1:0];
        return <>
          <T>{t(isSimilar ? "Message length" : "The Novelist vs The Texter")}</T>
          <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around",alignItems:"center"}}>
            {[0,1].map(i=>(
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:36,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[i]}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2}}>{t("avg chars")}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:1}}>max {(s.maxMsgLen?.[i] ?? 0).toLocaleString()}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:4}}>{s.names[i]}</div>
              </div>
            ))}
          </div>
          {(() => {
            const q = isSimilar
              ? pick(t("quips.duo.messageLengthSimilar"), `duo-msg-length-similar|${s.names.join("|")}|${s.totalMessages}|${s.avgMsgLen.join("|")}|${s.maxMsgLen?.join("|") || ""}`)
              : pick(t("quips.duo.messageLengthDifferent", { novelist, texter }), `duo-msg-length-different|${s.names.join("|")}|${s.totalMessages}|${novelist}|${texter}|${s.avgMsgLen.join("|")}|${s.maxMsgLen?.join("|") || ""}`);
            return <Quip>{q}</Quip>;
          })()}
        </>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={13} total={TOTAL} feedback={feedback("Media and links", 13)}>
      <T>{t("Media and links")}</T>
      <div style={{width:"100%",marginTop:16}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("Photos & videos")}</div>
        <Bar value={s.mediaCounts[0]} max={Math.max(...s.mediaCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.mediaCounts[1]} max={Math.max(...s.mediaCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("Voice memos")}</div>
        <Bar value={s.voiceCounts[0]} max={Math.max(...s.voiceCounts,1)} color="#C880F0" label={s.names[0]} />
        <Bar value={s.voiceCounts[1]} max={Math.max(...s.voiceCounts,1)} color="#9050D0" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("Links shared")}</div>
        <Bar value={s.linkCounts[0]} max={Math.max(...s.linkCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.linkCounts[1]} max={Math.max(...s.linkCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL} feedback={feedback("What you actually talk about", 14)}>
      <T>{t("What you actually talk about")}</T>
      <AICard label={t("Biggest topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL} feedback={feedback("The Drama Report", 15)}>
      <T>{t("The Drama Report")}</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label={t("How they do it")} value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL} feedback={feedback("What's really going on", 16)}>
      <T>{t("What's really going on")}</T>
      <AICard label={t(relReadLabel(relationshipType))} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL} feedback={feedback("Chat vibe", 17)}>
      <T>{t("Chat vibe")}</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||t("A chaotic, wholesome connection."))}
      </div>
      <Sub mt={14}>{t("Powered by AI — your messages never left your device.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL} feedback={feedback("Relationship reading", 1)}>
      <T>{t("Relationship reading")}</T>
      <Big>{relationshipStatus}</Big>
      <AICard label={t("Observed pattern")} value={relationshipStatusWhy} loading={aiLoading && !relationshipStatusWhy} />
      <AICard label={t("Concrete example")} value={statusEvidence} loading={aiLoading && !statusEvidence} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL} feedback={feedback("Evidence log", 2)}>
      <T>{t("Evidence log")}</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("What the chat shows", 3)}>
      <T>{t("What the chat shows")}</T>
      <FlagList flags={duoFlags} loading={aiLoading && !duoFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL} feedback={feedback("Toxicity scorecard", 4)}>
      <T>{t("Toxicity scorecard")}</T>
      <Big>{toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        <Bar value={s.toxicityScores[0]} max={toxicMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.toxicityScores[1]} max={toxicMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <AICard label={t("Why this person scores highest")} value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL} feedback={feedback("Tension snapshot", 5)}>
      <T>{t("Tension snapshot")}</T>
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <AICard label={t(relReadLabel(relationshipType))} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={6} total={TOTAL} feedback={feedback("What keeps repeating", 6)}>
      <T>{t("What keeps repeating")}</T>
      <AICard label={t("Main topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("Pattern note")} value={duoFlags[0]?.detail || t("The strongest pattern is shown above.")} loading={aiLoading && !duoFlags[0]?.detail} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={7} total={TOTAL} feedback={feedback("Toxicity report", 7)}>
      <T>{t("Toxicity report")}</T>
      <Big>{toxicityLevel}</Big>
      <AICard label={t("Overall read")} value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label={t("Score breakdown")} value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>{t("This mode is meant to surface patterns and examples, not make the decision for you.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// GROUP SCREENS
// ─────────────────────────────────────────────────────────────────
function GroupScreen({ s, ai, aiLoading, step, back, next, mode, resultId }) {
  const t = useT();
  const mMax   = Math.max(...s.msgCounts,1);
  const COLORS = ["#E06030","#4A90D4","#3ABDA0","#C4809A","#8A70D4","#D4A840"];
  const TOTAL  = mode === "redflags" ? GROUP_REDFLAG_SCREENS : GROUP_CASUAL_SCREENS;
  const reportKey = mode === "redflags" ? "toxicity" : "general";
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: reportKey, cardIndex, cardTitle } : null
  );
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || s.names[0];
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const groupFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = chatHealthLabel(ai?.chatHealthScore) || s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL} feedback={feedback("The Main Character", 1)}>
      <T>{t("The Main Character")}</T>
      <Big>{s.mainChar}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,6).map((n,i)=><Bar key={n} value={s.msgCounts[i]} max={mMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      {(() => {
      const q = pick(t("quips.group.mainCharacter", { name: s.mainChar }), `group-main-character|${s.names.join("|")}|${s.totalMessages}|${s.mainChar}|${s.msgCounts.join("|")}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL} feedback={feedback("The Ghost", 2)}>
      <T>{t("The Ghost")}</T>
      <Big>{s.ghost}</Big>
      <Sub>{t("{count} messages total. Why are they even here?", { count: s.msgCounts[s.msgCounts.length-1].toLocaleString() })}</Sub>
      {(() => {
      const q = pick(t("quips.group.ghost", { name: s.ghost }), `group-ghost|${s.names.join("|")}|${s.totalMessages}|${s.ghost}|${s.msgCounts.join("|")}`);
      return <Quip>{q}</Quip>;
    })()}
      <AICard label={t("What's really going on")} value={ai?.ghostContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("The Last Word", 3)}>
      <T>{t("The Last Word")}</T>
      <Big>{s.convKiller}</Big>
      <Sub>{t("Sends the last message that nobody replies to.")}</Sub>
      {(() => {
      const q = pick(t("quips.group.lastWord", { name: s.convKiller }), `group-last-word|${s.names.join("|")}|${s.totalMessages}|${s.convKiller}|${s.convKillerCount}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL} feedback={feedback("Top 3 most active months", 4)}>
      <T>{t("Top 3 most active months")}</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{t("The group was most alive in {month}.", { month: s.topMonths[0][0] })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL} feedback={feedback("Longest active streak", 5)}>
      <T>{t("Longest active streak")}</T>
      <Big>{t("{count} days", { count: s.streak })}</Big>
      <Sub>{t("The group kept the chat alive for {count} days straight.", { count: s.streak })}</Sub>
      {(() => {
        const q = s.streak >= 100
          ? pick(t("quips.group.streak100", { streak: s.streak }), `group-streak100|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
          : s.streak >= 30
            ? pick(t("quips.group.streak30", { streak: s.streak }), `group-streak30|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
            : s.streak >= 10
              ? pick(t("quips.group.streak10", { streak: s.streak }), `group-streak10|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
              : pick(t("quips.group.streakShort", { streak: s.streak }), `group-streak-short|${s.names.join("|")}|${s.totalMessages}|${s.streak}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL} feedback={feedback("The Hype Person", 6)}>
      <T>{t("The Hype Person")}</T>
      <Big>{s.hype}</Big>
      <Sub>{t("Started {pct} of all conversations. The engine of this group.", { pct: s.convStarterPct })}</Sub>
      <AICard label={t("Why {name} is the hype", { name: s.hype })} value={ai?.hypePersonReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL} feedback={feedback("The Kindest One", 7)}>
      <T>{t("The Kindest One")}</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "—")}</Big>
      <AICard label={t("The sweetest moment")} value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL} feedback={feedback("The Funny One", 8)}>
      <T>{t("The Funny One")}</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label={t("Drops lines like")} value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL} feedback={feedback("Group spirit emoji", 9)}>
      <T>{t("Group spirit emoji")}</T>
      <div style={{fontSize:90,textAlign:"center",marginTop:16,lineHeight:1,width:"100%"}}>{s.spiritEmoji[0]}</div>
      <Sub>{t("This one emoji basically summarises the entire group energy.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL} feedback={feedback("Top 10 most used words", 10)}>
      <T>{t("Top 10 most used words")}</T>
      <Words words={s.topWords} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={11} total={TOTAL} feedback={feedback("The Novelist", 11)}>
      <T>{t("The Novelist")}</T>
      <Big>{s.novelist}</Big>
      <div style={{display:"flex",gap:0,marginTop:12,width:"100%",justifyContent:"space-around"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[[...s.names].sort((a,b)=>s.msgCounts[s.names.indexOf(b)]-s.msgCounts[s.names.indexOf(a)]).indexOf(s.novelist)]||s.avgMsgLen[0]}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>{t("avg chars")}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.novelistMaxLen.toLocaleString()}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>{t("longest message")}</div>
        </div>
      </div>
      {s.novelistLongestTopic && <Sub mt={8}>{t("Their longest message was mostly about \"{topic}\".", { topic: s.novelistLongestTopic })}</Sub>}
      <Quip>{pick(t("quips.group.novelist", { name: s.novelist }), `group-novelist|${s.names.join("|")}|${s.totalMessages}|${s.novelist}|${s.novelistMaxLen}`)}</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL} feedback={feedback("Group roles", 12)}>
      <T>Group roles</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        <Cell label={s.photographerIsVoice ? "Voice Note Addict" : "Photographer"} value={s.photographer} />
        <Cell label="The Therapist" value={s.therapist} />
        <Cell label="Night owl" value={s.nightOwl} />
        <Cell label="Early bird" value={s.earlyBird} />
        <Cell label="Voice memo king" value={s.voiceChampion} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={13} total={TOTAL} feedback={feedback("What you actually talk about", 13)}>
      <T>{t("What you actually talk about")}</T>
      <AICard label={t("Biggest topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("The inside joke")} value={ai?.insideJoke} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL} feedback={feedback("The Drama Report", 14)}>
      <T>{t("The Drama Report")}</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label={t("How they do it")} value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL} feedback={feedback("Most missed member", 15)}>
      <T>{t("Most missed member")}</T>
      <Big>{aiLoading?"...":(ai?.mostMissed||s.names[0])}</Big>
      <Sub>{t("When they go quiet, the group feels it.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL} feedback={feedback("The group read", 16)}>
      <T>{t("The group read")}</T>
      <AICard label={t("Group dynamic")} value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL} feedback={feedback("Group vibe", 17)}>
      <T>{t("Group vibe")}</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||t("Chaotic. Wholesome. Somehow still going."))}
      </div>
      <Sub mt={14}>{t("Powered by AI — your messages never left your device.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL} feedback={feedback("Group pattern read", 1)}>
      <T>{t("Group pattern read")}</T>
      <AICard label={t("Group dynamic")} value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL} feedback={feedback("Evidence log", 2)}>
      <T>{t("Evidence log")}</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("What the chat shows", 3)}>
      <T>{t("What the chat shows")}</T>
      <FlagList flags={groupFlags} loading={aiLoading && !groupFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL} feedback={feedback("Toxicity scorecard", 4)}>
      <T>{t("Toxicity scorecard")}</T>
      <Big>{aiLoading && !toxicName ? "..." : toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,4).map((n,i)=><Bar key={n} value={s.toxicityScores[i]} max={toxicMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      <AICard label={t("Why this person scores highest")} value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL} feedback={feedback("Support and strain", 5)}>
      <T>{t("Support and strain")}</T>
      <AICard label={t("Who keeps it going")} value={s.hype ? t("{name} started {pct} of conversations.", { name: s.hype, pct: s.convStarterPct }) : t("The group shares the conversation starts.")} loading={false} />
      <AICard label={t("Who goes quiet")} value={s.ghost ? t("{name} is the least active member in the sampled history.", { name: s.ghost }) : t("No clear ghost in this sample.")} loading={false} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={6} total={TOTAL} feedback={feedback("Toxicity report", 6)}>
      <T>{t("Toxicity report")}</T>
      <Big>{toxicityLevel}</Big>
      <AICard label={t("Overall read")} value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label={t("Score breakdown")} value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>{t("This mode is meant to surface patterns and examples, not make the decision for you.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// SCORE RING — animated circular score display
// ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, max=10, size=110, color="#fff" }) {
  const [pct, setPct] = useState(0);
  useEffect(() => { const t = setTimeout(() => setPct(score / max), 150); return () => clearTimeout(t); }, [score, max]);
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:size > 90 ? 28 : 20, fontWeight:800, color:"#fff", lineHeight:1 }}>{score}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginTop:2 }}>/{max}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TOXICITY REPORT SCREENS  (7 cards)
// ─────────────────────────────────────────────────────────────────
const TOXICITY_SCREENS = 7;
function ToxicityReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "toxicity", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="toxicity" prog={1} total={TOXICITY_SCREENS} feedback={feedback("Chat Health Score", 1)}>
      <T>{t("Chat Health Score")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore || 5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={12}>{t("Out of 10 — based on conflict patterns, communication style, and overall dynamic.")}</Sub>
      <AICard label={t("Verdict")} value={ai?.verdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="toxicity" prog={2} total={TOXICITY_SCREENS} feedback={feedback("Individual health scores", 2)}>
      <T>{t("Individual health scores")}</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, marginTop:16 }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,score:5,detail:"Analysing…"})) : (ai?.healthScores||[])).map((p, i) => (
          <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", display:"flex", alignItems:"center", gap:14 }}>
            <ScoreRing score={loading ? 0 : (p.score||5)} max={10} size={80} color={i===0?"#E06030":"#4A90D4"} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:17, fontWeight:800, color:"#fff", marginBottom:4 }}>{p.name}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{loading ? "…" : (p.detail||"—")}</div>
            </div>
          </div>
        ))}
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={3} total={TOXICITY_SCREENS} feedback={feedback("Who apologises more", 3)}>
      <T>{t("Who apologises more")}</T>
      <Big>{loading ? "…" : (ai?.apologiesLeader?.name || s.names[0])}</Big>
      <AICard label={`${(loading?"…":ai?.apologiesLeader?.name) || s.names[0]} — context`} value={ai?.apologiesLeader?.context} loading={loading} />
      <AICard label={`${(loading?"…":ai?.apologiesOther?.name) || s.names[1]||s.names[0]} — context`} value={ai?.apologiesOther?.context} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={4} total={TOXICITY_SCREENS} feedback={feedback("Red flag moments", 4)}>
      <T>{t("Red flag moments")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
            {(ai?.redFlagMoments||[]).map((m, i) => (
              <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{m.date} • {m.person}</div>
                <div style={{ fontSize:14, fontWeight:700, color:"#fff", marginBottom:4 }}>{m.description}</div>
                {m.quote && <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", fontStyle:"italic" }}>"{m.quote}"</div>}
              </div>
            ))}
          </div>
      }
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={5} total={TOXICITY_SCREENS} feedback={feedback("Conflict pattern", 5)}>
      <T>{t("Conflict pattern")}</T>
      <AICard label={t("How arguments unfold")} value={ai?.conflictPattern} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={6} total={TOXICITY_SCREENS} feedback={feedback("Power balance", 6)}>
      <T>{t("Power balance")}</T>
      <Big>{loading ? "…" : reportControl(ai?.powerHolder || t("Balanced"))}</Big>
      <AICard label={t("Power dynamic")} value={ai?.powerBalance} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={7} total={TOXICITY_SCREENS} feedback={feedback("The verdict", 7)}>
      <T>{t("The verdict")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore||5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={8}>{t("Overall chat health score.")}</Sub>
      <AICard label={t("Final read")} value={ai?.verdict} loading={loading} />
      <Sub mt={8}>{t("Reflects patterns in this sample — not a final judgment.")}</Sub>
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// LOVE LANGUAGE REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const LOVELANG_SCREENS = 5;
function LoveLangReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personATitle = `${ai?.personA?.name || s.names[0]}'s love language`;
  const personBTitle = `${ai?.personB?.name || s.names[1] || s.names[0]}'s love language`;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "lovelang", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="lovelang" prog={1} total={LOVELANG_SCREENS} feedback={feedback(personATitle, 1)}>
      <T>{loading ? "…" : t("{name}'s love language", { name: ai?.personA?.name || s.names[0] })}</T>
      <div style={{ marginTop:12, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
        <div style={{ fontSize:60, lineHeight:1 }}>{loading ? "💝" : (ai?.personA?.languageEmoji || "💝")}</div>
        <Big>{loading ? "…" : reportControl(ai?.personA?.language || "—")}</Big>
      </div>
      <AICard label={t("How they show it")} value={ai?.personA?.examples} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="lovelang" prog={2} total={LOVELANG_SCREENS} feedback={feedback(personBTitle, 2)}>
      <T>{loading ? "…" : t("{name}'s love language", { name: ai?.personB?.name || s.names[1]||s.names[0] })}</T>
      <div style={{ marginTop:12, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
        <div style={{ fontSize:60, lineHeight:1 }}>{loading ? "💝" : (ai?.personB?.languageEmoji || "💝")}</div>
        <Big>{loading ? "…" : reportControl(ai?.personB?.language || "—")}</Big>
      </div>
      <AICard label={t("How they show it")} value={ai?.personB?.examples} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={3} total={LOVELANG_SCREENS} feedback={feedback("The language gap", 3)}>
      <T>{t("The language gap")}</T>
      <AICard label={t("Do they speak the same language?")} value={ai?.mismatch} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={4} total={LOVELANG_SCREENS} feedback={feedback("Most loving moment", 4)}>
      <T>{t("Most loving moment")}</T>
      <div style={{ fontSize:40, textAlign:"center", marginTop:16 }}>💕</div>
      <AICard label={t("The moment")} value={ai?.mostLovingMoment} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={5} total={LOVELANG_SCREENS} feedback={feedback("Love language compatibility", 5)}>
      <T>{t("Love language compatibility")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.compatibilityScore||5)} max={10} size={130} color="#F08EBF" />
      </div>
      <AICard label={t("Compatibility read")} value={ai?.compatibilityRead} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// GROWTH REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const GROWTH_SCREENS = 5;
function GrowthReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const arrowMap = { deeper:"↑", shallower:"↓", "about the same":"→" };
  const trajMap  = { closer:"Getting closer", drifting:"Drifting apart", stable:"Holding steady" };
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "growth", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="growth" prog={1} total={GROWTH_SCREENS} feedback={feedback("Then vs Now", 1)}>
      <T>{t("Then vs Now")}</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
        <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", borderLeft:"3px solid rgba(255,255,255,0.2)" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", marginBottom:6 }}>{t("Early messages")}</div>
          <div style={{ fontSize:14, color:"#fff", lineHeight:1.6 }}>{loading ? <Dots /> : (ai?.thenDepth||"—")}</div>
        </div>
        <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", borderLeft:"3px solid #3AF0C0" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", marginBottom:6 }}>{t("Recent messages")}</div>
          <div style={{ fontSize:14, color:"#fff", lineHeight:1.6 }}>{loading ? <Dots /> : (ai?.nowDepth||"—")}</div>
        </div>
      </div>
      {!loading && ai?.depthChange && (
        <Sub mt={8}>Conversations got <strong style={{color:"#3AF0C0"}}>{reportControl(ai.depthChange)}</strong> {arrowMap[ai.depthChange]||""} over time.</Sub>
      )}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="growth" prog={2} total={GROWTH_SCREENS} feedback={feedback("Who changed more", 2)}>
      <T>{t("Who changed more")}</T>
      <Big>{loading ? "…" : (ai?.whoChangedMore||"—")}</Big>
      <AICard label={t("How they changed")} value={ai?.whoChangedHow} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={3} total={GROWTH_SCREENS} feedback={feedback("What changed in the chat", 3)}>
      <T>{t("What changed in the chat")}</T>
      <AICard label={t("Topics that appeared")} value={ai?.topicsAppeared} loading={loading} />
      <AICard label={t("Topics that faded")} value={ai?.topicsDisappeared} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={4} total={GROWTH_SCREENS} feedback={feedback("Relationship trajectory", 4)}>
      <T>{t("Relationship trajectory")}</T>
      <Big>{loading ? "…" : (resultLang === "en" ? (trajMap[ai?.trajectory] || ai?.trajectory || "—") : reportControl(ai?.trajectory || "—"))}</Big>
      <AICard label={t("What the data shows")} value={ai?.trajectoryDetail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={5} total={GROWTH_SCREENS} feedback={feedback("The arc", 5)}>
      <T>{t("The arc")}</T>
      <div style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"1.4rem 1.5rem", width:"100%", textAlign:"center", marginTop:16, fontSize:16, lineHeight:1.7, fontStyle:"italic", color:"#fff", minHeight:80, display:"flex", alignItems:"center", justifyContent:"center" }}>
        {loading ? <Dots /> : (ai?.arcSummary||"—")}
      </div>
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ACCOUNTABILITY REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const ACCOUNTA_SCREENS = 5;
function AccountaReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const personATitle = `${ai?.personA?.name || s.names[0]}'s accountability`;
  const personBTitle = `${ai?.personB?.name || s.names[1] || s.names[0]}'s accountability`;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "accounta", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="accounta" prog={1} total={ACCOUNTA_SCREENS} feedback={feedback("Promises made", 1)}>
      <T>{t("Promises made")}</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {[ai?.personA, ai?.personB].filter(Boolean).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center" }}>
            <div style={{ fontSize:34, fontWeight:800, color:"#fff" }}>{loading ? "—" : (p.total||0)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:4 }}>{t("promises")}</div>
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)", marginTop:6 }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Overall verdict")} value={ai?.overallVerdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="accounta" prog={2} total={ACCOUNTA_SCREENS} feedback={feedback(personATitle, 2)}>
      <T>{loading ? "…" : t("{name}'s accountability", { name: ai?.personA?.name || s.names[0] })}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personA?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personA?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("kept")}</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personA?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("broken")}</div>
        </div>
      </div>
      <AICard label={t("Pattern")} value={ai?.personA?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={3} total={ACCOUNTA_SCREENS} feedback={feedback(personBTitle, 3)}>
      <T>{loading ? "…" : t("{name}'s accountability", { name: ai?.personB?.name || s.names[1]||s.names[0] })}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personB?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personB?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("kept")}</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personB?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("broken")}</div>
        </div>
      </div>
      <AICard label={t("Pattern")} value={ai?.personB?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={4} total={ACCOUNTA_SCREENS} feedback={feedback("Most notable broken promise", 4)}>
      <T>{t("Most notable broken promise")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", marginTop:16 }}>
            <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px" }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{ai?.notableBroken?.date||""}{ai?.notableBroken?.date&&ai?.notableBroken?.person?" • ":""}{ai?.notableBroken?.person||""}</div>
              <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginBottom:6 }}>"{ai?.notableBroken?.promise||"—"}"</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.55 }}>{ai?.notableBroken?.outcome||""}</div>
            </div>
          </div>
      }
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={5} total={ACCOUNTA_SCREENS} feedback={feedback("Most notable kept promise", 5)}>
      <T>{t("Most notable kept promise")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", marginTop:16 }}>
            <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px" }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{ai?.notableKept?.date||""}{ai?.notableKept?.date&&ai?.notableKept?.person?" • ":""}{ai?.notableKept?.person||""}</div>
              <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginBottom:6 }}>"{ai?.notableKept?.promise||"—"}"</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.55 }}>{ai?.notableKept?.outcome||""}</div>
            </div>
          </div>
      }
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ENERGY REPORT SCREENS  (6 cards)
// ─────────────────────────────────────────────────────────────────
const ENERGY_SCREENS = 6;
function EnergyReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personATitle = `${ai?.personA?.name || s.names[0]}'s energy`;
  const personBTitle = `${ai?.personB?.name || s.names[1] || s.names[0]}'s energy`;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "energy", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="energy" prog={1} total={ENERGY_SCREENS} feedback={feedback("Net energy scores", 1)}>
      <T>{t("Net energy scores")}</T>
      <div style={{ width:"100%", display:"flex", gap:16, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5,type:""})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={90} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", textAlign:"center" }}>{loading ? "…" : reportControl(p.type || "")}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Energy compatibility")} value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="energy" prog={2} total={ENERGY_SCREENS} feedback={feedback(personATitle, 2)}>
      <T>{loading ? "…" : t("{name}'s energy", { name: ai?.personA?.name || s.names[0] })}</T>
      <AICard label={t("Positive energy")} value={ai?.personA?.goodNews} loading={loading} />
      <AICard label={t("Draining patterns")} value={ai?.personA?.venting} loading={loading} />
      {!loading && ai?.personA?.hypeQuote && <Quip>"{ai.personA.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={3} total={ENERGY_SCREENS} feedback={feedback(personBTitle, 3)}>
      <T>{loading ? "…" : t("{name}'s energy", { name: ai?.personB?.name || s.names[1]||s.names[0] })}</T>
      <AICard label={t("Positive energy")} value={ai?.personB?.goodNews} loading={loading} />
      <AICard label={t("Draining patterns")} value={ai?.personB?.venting} loading={loading} />
      {!loading && ai?.personB?.hypeQuote && <Quip>"{ai.personB.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={4} total={ENERGY_SCREENS} feedback={feedback("Most energising moment", 4)}>
      <T>{t("Most energising moment")}</T>
      <div style={{ fontSize:40, textAlign:"center", marginTop:16 }}>⚡</div>
      <AICard label={t("The moment")} value={ai?.mostEnergising} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={5} total={ENERGY_SCREENS} feedback={feedback("Most draining moment", 5)}>
      <T>{t("Most draining moment")}</T>
      <div style={{ fontSize:40, textAlign:"center", marginTop:16 }}>🪫</div>
      <AICard label={t("The moment")} value={ai?.mostDraining} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={6} total={ENERGY_SCREENS} feedback={feedback("Energy compatibility", 6)}>
      <T>{t("Energy compatibility")}</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 12px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={72} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Overall read")} value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// PREMIUM FINALE — wrap-up for non-general reports
// ─────────────────────────────────────────────────────────────────
function PremiumFinale({ s, restart, back, reportType }) {
  const t = useT();
  const rtype = REPORT_TYPES.find(r => r.id === reportType);
  const sec = rtype?.palette || "upload";
  return (
    <Shell sec={sec} prog={1} total={1}>
      <T s={22}>{t(rtype?.label || "Report complete")}</T>
      <Sub mt={4}>{s.names?.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} {t("messages")}</Sub>
      <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"center", width:"100%" }}>
        <Btn onClick={back}>{t("Back")}</Btn>
        <Btn onClick={restart}>{t("Start over")}</Btn>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// FINALE
// ─────────────────────────────────────────────────────────────────
function Finale({ s, ai, aiLoading, restart, back, prog, total, mode, resultId }) {
  const t = useT();
  const feedback = resultId && (mode === "redflags" || ai?.vibeOneLiner)
    ? { resultId, reportType: mode === "redflags" ? "toxicity" : "general", cardIndex: prog, cardTitle: mode === "redflags" ? "Red flags, unwrapped." : (s.isGroup ? "Your group, unwrapped." : "Your chat, unwrapped.") }
    : null;
  const cells = mode === "redflags"
    ? (s.isGroup
      ? [
          {label:"Most toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Ghost",value:s.ghost},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ]
      : [
          {label:"Status guess",value:ai?.relationshipStatus || s.relationshipStatus || "—"},
          {label:"More toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ])
    : (s.isGroup
      ? [
          {label:"Main character",value:s.mainChar},
          {label:"The ghost",value:s.ghost},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Top month",value:s.topMonths[0]?.[0]},
        ]
      : [
          {label:"Most texts",value:s.names[0]},
          {label:"Ghost award",value:s.ghostName},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Spirit emojis",value:s.spiritEmoji.join(" ")},
          {label:"Best streak",value:t("{count} days", { count: s.streak })},
        ]);
  return (
    <Shell sec="finale" prog={prog} total={total} feedback={feedback}>
      <T s={24}>{t(mode === "redflags" ? "Red flags, unwrapped." : (s.isGroup?"Your group, unwrapped.":"Your chat, unwrapped."))}</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        {cells.map((c,i)=><Cell key={i} label={t(c.label)} value={c.value} />)}
      </div>
      {!aiLoading&&ai?.vibeOneLiner&&(
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:20,padding:"14px 18px",width:"100%",fontSize:14,fontStyle:"italic",color:"rgba(255,255,255,0.75)",textAlign:"center",lineHeight:1.6,fontWeight:500}}>"{ai.vibeOneLiner}"</div>
      )}
      <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"center",width:"100%"}}>
        <Btn onClick={back}>{t("Back")}</Btn>
        <Btn onClick={restart}>{t("Start over")}</Btn>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP CONTEXT HELPERS
// ─────────────────────────────────────────────────────────────────
function relContextStr(relType) {
  const map = {
    partner:   "committed romantic partner or spouse",
    dating:    "early stage or casual romantic relationship",
    ex:        "former romantic partner — the relationship has ended",
    family:    "This is a chat between the user and a family member (parent, sibling, or relative).",
    friend:    "This is a chat between the user and a close friend.",
    colleague: "This is a chat between the user and a work colleague.",
    other:     "This is a chat between the user and someone they know.",
  };
  return relType ? (map[relType] || "") : "";
}

function relReadLabel(relType) {
  return {
    partner:   "Partnership read",
    family:    "Family dynamic",
    friend:    "Friendship read",
    colleague: "Work dynamic",
  }[relType] || "Relationship read";
}

function hasAcceptedCurrentTerms(user) {
  const meta = user?.user_metadata || {};
  return meta.terms_accepted === true && meta.terms_version === LEGAL_VERSION;
}

function postAuthPhaseForUser(user) {
  const meta = user?.user_metadata || {};
  if (hasAcceptedCurrentTerms(user)) return "upload";
  if (meta.has_onboarded === true) return "terms";
  return "onboarding";
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP SELECT SCREEN
// ─────────────────────────────────────────────────────────────────
function RelationshipSelect({ onSelect, onBack, error = "" }) {
  const t = useT();
  const romanticOptions = [
    { id:"partner", label:"Partner", icon:partnerIcon, desc:"Romantic partner or spouse" },
    { id:"dating",  label:"Dating",  icon:datingIcon, desc:"Seeing each other or early stages" },
    { id:"ex",      label:"Ex",      icon:exIcon, desc:"Former romantic partner" },
  ];
  const options = [
    { id:"family",    label:"Related",   icon:familyIcon, desc:"Parent, sibling or relative" },
    { id:"friend",    label:"Friend",    icon:friendIcon, desc:"Close friend or bestie" },
    { id:"colleague", label:"Colleague", icon:colleagueIcon, desc:"Coworker or professional contact" },
    { id:"other",     label:"Other",     icon:otherIcon, desc:"Someone you know" },
  ];
  const optionButtonStyle = {
    background:"rgba(255,255,255,0.08)",
    border:"1px solid rgba(255,255,255,0.14)",
    borderRadius:20,
    color:"#fff",
    cursor:"pointer",
    transition:"all 0.15s",
    width:"100%",
    minHeight:80,
  };
  const iconStyle = {
    width:32,
    height:32,
    objectFit:"contain",
    filter:"brightness(0) invert(1)",
    opacity:0.96,
  };
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.15, textAlign:"center", width:"100%" }}>{t("Who is this chat with?")}</div>
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.52)", textAlign:"center", lineHeight:1.6, width:"100%" }}>{t("This helps the AI frame the analysis correctly.")}</div>
      {error && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{error}</div>}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:6 }}>
        <div style={{ display:"flex", gap:10, width:"100%" }}>
          {romanticOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
            className="wc-btn"
            style={{ ...optionButtonStyle, flex:1, padding:"12px 10px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center" }}
          >
              <img src={opt.icon} alt="" aria-hidden="true" style={{ ...iconStyle, marginBottom:8 }} />
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3 }}>{t(opt.label)}</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4 }}>{t(opt.desc)}</div>
            </button>
          ))}
        </div>
        {options.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            className="wc-btn"
            style={{ ...optionButtonStyle, padding:"16px 18px", display:"flex", alignItems:"center", gap:14, textAlign:"left" }}
          >
            <img src={opt.icon} alt="" aria-hidden="true" style={{ ...iconStyle, flexShrink:0 }} />
            <div>
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3 }}>{t(opt.label)}</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:2 }}>{t(opt.desc)}</div>
            </div>
          </button>
        ))}
      </div>
      <Btn onClick={onBack}>{t("Back")}</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
function Auth() {
  const [tab,      setTab]      = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [info,     setInfo]     = useState("");
  const [busy,     setBusy]     = useState(false);

  const switchTab = (t) => { setTab(t); setErr(""); setInfo(""); };

  const submit = async () => {
    if (!email || !password) { setErr("Please fill in both fields."); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(error.message);
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) setErr(error.message);
        else setInfo("Check your email to confirm your account, then log in.");
      }
    } catch { setErr("Something went wrong. Please try again."); }
    setBusy(false);
  };

  const inputStyle = {
    width: "100%",
    background: "rgba(0,0,0,0.25)",
    border: "1.5px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: "13px 16px",
    fontSize: 15,
    color: "#fff",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.5)", marginBottom:4, textAlign:"center", fontWeight:500 }}>Your chats, unwrapped.</div>

      {/* Tab toggle */}
      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:50, padding:4, width:"100%", gap:4 }}>
        {[["login","Log in"],["signup","Sign up"]].map(([t,label]) => (
          <button key={t} onClick={() => switchTab(t)}
            style={{
              flex:1, border:"none", borderRadius:46, padding:"10px 0",
              fontSize:14, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
              background: tab === t ? "rgba(255,255,255,0.18)" : "transparent",
              color: tab === t ? "#fff" : "rgba(255,255,255,0.38)",
              letterSpacing: 0.2,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Inputs */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <input
          type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
      </div>

      {err  && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>}
      {info && <div style={{ fontSize:13, color:"#B0F4C8", background:"rgba(20,160,80,0.15)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{info}</div>}

      <button
        onClick={submit} disabled={busy} className="wc-btn"
        style={{ width:"100%", padding:"14px 0", borderRadius:50, border:"none", background: PAL.upload.inner, color:"#fff", fontSize:16, cursor: busy ? "default" : "pointer", fontWeight:700, transition:"all 0.15s", letterSpacing:0.2, opacity: busy ? 0.65 : 1 }}
      >
        {busy ? "…" : tab === "login" ? "Log in" : "Create account"}
      </button>

      <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", textAlign:"center" }}>Your chat is analysed by AI and never stored. Only results are saved.</div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// ONBOARDING (3 screens, first-login only)
// ─────────────────────────────────────────────────────────────────
const ONBOARD_PILLS = [
  { label: "Toxicity",       palette: "toxicity" },
  { label: "Love Languages", palette: "lovelang" },
  { label: "Accountability", palette: "accounta" },
  { label: "Energy",         palette: "energy"   },
  { label: "Growth",         palette: "growth"   },
  { label: "Chat Wrapped",   palette: "upload"   },
];

const EXPORT_STEPS = [
  "Open WhatsApp",
  "Tap the chat you want to analyse",
  "Tap ··· menu → More → Export Chat",
  "Choose Without Media",
  "Save the .txt file to your device",
];

function OnboardingFlow({ step, next, onOnboarded, onLogout }) {
  const { uiLangPref } = useUILanguage();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err]           = useState("");
  const [selectedUiLang, setSelectedUiLang] = useState(uiLangPref);

  useEffect(() => {
    setSelectedUiLang(uiLangPref);
  }, [uiLangPref]);

  const markOnboarded = async (pref, thenCb) => {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.updateUser({ data: { has_onboarded: true, ui_language: normalizeUiLangPref(pref) } });
    } catch { /* silent — non-critical */ }
    thenCb?.();
  };

  const handleSkip   = () => markOnboarded("english", () => onOnboarded?.("english"));
  const handleFinish = () => markOnboarded(selectedUiLang, () => onOnboarded?.(selectedUiLang));

  const linkBtn = { background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={step + 1} total={4}>

      {/* ── Screen 1: hook ── */}
      {step === 0 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Your relationship, in data.")}
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.75, width:"100%" }}>
          {t("Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.")}
        </div>
        <Btn onClick={next}>{t("Next")}</Btn>
        <button onClick={handleSkip} style={linkBtn}>{t("Skip")}</button>
      </>)}

      {/* ── Screen 2: export instructions ── */}
      {step === 1 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Start with your chat.")}
        </div>
        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:9 }}>
          {EXPORT_STEPS.map((label, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:14, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"13px 16px" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:PAL.upload.inner, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", flexShrink:0 }}>
                {i + 1}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:"#fff", lineHeight:1.4 }}>{t(label)}</div>
            </div>
          ))}
        </div>
        <Btn onClick={next}>{t("Next")}</Btn>
      </>)}

      {/* ── Screen 3: launch ── */}
      {step === 2 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Upload. Analyse. See it clearly.")}
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.75, width:"100%" }}>
          {t("Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.")}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", width:"100%" }}>
          {ONBOARD_PILLS.map(pill => {
            const p = PAL[pill.palette] || PAL.upload;
            return (
              <div key={pill.label} style={{ background:p.inner, color:"#fff", borderRadius:50, padding:"7px 16px", fontSize:13, fontWeight:700, letterSpacing:0.1 }}>
                {t(pill.label)}
              </div>
            );
          })}
        </div>
        {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}
        <Btn onClick={next}>{t("Continue")}</Btn>
      </>)}

      {step === 3 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Choose your language")}
        </div>
        <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {[
            { id:"english", title:"English", desc:"Use English for the interface." },
            { id:"auto", title:"Auto-detect", desc:"UI follows the detected chat language." },
          ].map(option => {
            const active = selectedUiLang === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedUiLang(option.id)}
                className="wc-btn"
                style={{
                  background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)",
                  border:`1px solid ${active ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.12)"}`,
                  borderRadius:22,
                  color:"#fff",
                  textAlign:"left",
                  padding:"18px 16px",
                  display:"flex",
                  flexDirection:"column",
                  gap:6,
                  minHeight:116,
                  cursor:"pointer",
                  transition:"all 0.15s",
                }}
              >
                <div style={{ fontSize:16, fontWeight:800, letterSpacing:-0.3 }}>{t(option.title)}</div>
                <div style={{ fontSize:12.5, color:"rgba(255,255,255,0.58)", lineHeight:1.55 }}>{t(option.desc)}</div>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleFinish}
          disabled={busy}
          className="wc-btn"
          style={{ width:"100%", padding:"14px 0", borderRadius:50, border:"none", background:PAL.upload.inner, color:"#fff", fontSize:16, cursor:busy?"default":"pointer", fontWeight:700, transition:"all 0.15s", letterSpacing:0.2, opacity:busy?0.65:1 }}
        >
          {busy ? "…" : t("Continue")}
        </button>
      </>)}

      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onLogout && <button onClick={onLogout} className="wc-btn" style={linkBtn}>{t("Log out")}</button>}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// TERMS & PRIVACY ACCEPTANCE (separate step, after onboarding)
// ─────────────────────────────────────────────────────────────────
function TermsFlow({ onAccepted, onLogout }) {
  const [activeTab,    setActiveTab]    = useState("tos");
  const [tosRead,      setTosRead]      = useState(false);
  const [privacyRead,  setPrivacyRead]  = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [err,          setErr]          = useState("");
  const tosRef     = useRef(null);
  const privacyRef = useRef(null);

  const bothRead = tosRead && privacyRead;

  const checkRead = (tab) => {
    const el = tab === "tos" ? tosRef.current : privacyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      if (tab === "tos")     setTosRead(true);
      else                   setPrivacyRead(true);
    }
  };

  // check on mount in case content is shorter than container
  useEffect(() => { checkRead("tos"); checkRead("privacy"); }, []); // eslint-disable-line

  const acceptTerms = async () => {
    if (!bothRead || busy) return;
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          terms_accepted: true,
          terms_version: LEGAL_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      });
      if (error) { setErr(error.message || "Could not save. Please try again."); setBusy(false); return; }
      onAccepted?.();
    } catch {
      setErr("Could not save. Please try again.");
      setBusy(false);
    }
  };

  const tabBtn = (tab, isRead) => ({
    flex:1, border:"none", borderRadius:46, padding:"10px 6px",
    fontSize:13, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
    background: activeTab === tab ? "rgba(255,255,255,0.18)" : "transparent",
    color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.38)",
    letterSpacing:0.1,
    display:"flex", alignItems:"center", justifyContent:"center", gap:5,
    opacity: isRead && activeTab !== tab ? 0.7 : 1,
  });

  const scrollBox = {
    height:"40vh", overflowY:"auto",
    background:"rgba(0,0,0,0.22)", borderRadius:20,
    padding:"18px 20px", width:"100%",
    fontSize:12.5, color:"rgba(255,255,255,0.62)", lineHeight:1.8,
    fontFamily:"inherit", whiteSpace:"pre-wrap",
  };

  const checkMark = (read) => read
    ? <span style={{ color:PAL.growth.accent, fontWeight:800 }}>✓</span>
    : null;

  const linkBtn = { background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.15, textAlign:"center", width:"100%" }}>
        One thing before you start.
      </div>
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", textAlign:"center", lineHeight:1.6, width:"100%" }}>
        Read both documents below before continuing.
      </div>

      {/* Tab switcher */}
      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:50, padding:4, width:"100%", gap:4 }}>
        <button onClick={() => setActiveTab("tos")} style={tabBtn("tos", tosRead)}>
          Terms of Service {checkMark(tosRead)}
        </button>
        <button onClick={() => setActiveTab("privacy")} style={tabBtn("privacy", privacyRead)}>
          Privacy Policy {checkMark(privacyRead)}
        </button>
      </div>

      {/* Scrollable document bodies — both mounted so scroll position is preserved */}
      <div
        ref={tosRef}
        onScroll={() => checkRead("tos")}
        style={{ ...scrollBox, display: activeTab === "tos" ? "block" : "none" }}
      >
        {TERMS_OF_SERVICE_TEXT}
      </div>
      <div
        ref={privacyRef}
        onScroll={() => checkRead("privacy")}
        style={{ ...scrollBox, display: activeTab === "privacy" ? "block" : "none" }}
      >
        {PRIVACY_POLICY_TEXT}
      </div>

      {!bothRead && (
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.28)", textAlign:"center" }}>
          {!tosRead && !privacyRead
            ? "Scroll through both documents to continue."
            : !tosRead
              ? "Scroll to the bottom of Terms of Service."
              : "Scroll to the bottom of Privacy Policy."}
        </div>
      )}

      {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}

      <button
        type="button"
        onClick={acceptTerms}
        disabled={!bothRead || busy}
        className="wc-btn"
        style={{
          width:"100%", padding:"14px 0", borderRadius:50, border:"none",
          background: PAL.upload.inner, color:"#fff", fontSize:15,
          cursor: !bothRead || busy ? "default" : "pointer",
          fontWeight:700, transition:"all 0.15s", letterSpacing:0.1,
          opacity: !bothRead || busy ? 0.38 : 1,
        }}
      >
        {busy ? "Saving…" : "I have read and accept both documents."}
      </button>

      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onLogout && <button onClick={onLogout} className="wc-btn" style={linkBtn}>Log out</button>}
      </div>
    </Shell>
  );
}

function TooShort({ onBack }) {
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"32px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:40, lineHeight:1 }}>🤐</div>
        <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-0.5, marginTop:14, lineHeight:1.2 }}>
          Not enough messages to wrap
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginTop:10, lineHeight:1.75 }}>
          This chat has fewer than {MIN_MESSAGES} messages after filtering system messages. WrapChat needs more to work with.
        </div>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", textAlign:"center", lineHeight:1.8 }}>
        Try exporting a longer chat history.
      </div>
      <Btn onClick={onBack}>← Upload a different file</Btn>
    </Shell>
  );
}

function AdminLocked({ onBack }) {
  return (
    <Shell sec="upload" prog={0} total={0}>
      <div style={{ fontSize:32, fontWeight:800, color:"#fff", letterSpacing:-1.2, lineHeight:1.1, textAlign:"center", width:"100%" }}>Admin access only</div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:36, lineHeight:1 }}>🔒</div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.58)", marginTop:12, lineHeight:1.7 }}>
          This inbox is only visible to the configured admin email.
        </div>
      </div>
      <Btn onClick={onBack}>← Back</Btn>
    </Shell>
  );
}

function Upload({ onParsed, onLogout, onHistory, onAdmin, canAdmin, uploadError = "", onClearError }) {
  const { uiLangPref, updateUiLangPref } = useUILanguage();
  const t = useT();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const showAdminEntry = Boolean(onAdmin) && ADMIN_EMAILS.length > 0;
  const uploadInputId = "wrapchat-upload-input";
  const displayErr = err || uploadError;

  const handle = async file => {
    if (!file) return;
    onClearError?.();
    setBusy(true); setErr("");
    try {
      const result = await processImportedChatFile(file);
      onParsed(result.payload);
    } catch (error) {
      setErr(String(error?.message || "Couldn't open this file. Please export the chat again and retry."));
      setBusy(false);
    }
  };
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.5)", marginBottom:8, textAlign:"center", fontWeight:500 }}>{t("Your chats, unwrapped.")}</div>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.34)", fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>{t("UI language")}</div>
        {["english", "auto"].map(option => {
          const active = uiLangPref === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => updateUiLangPref(option)}
              className="wc-btn"
              style={{
                border:"1px solid rgba(255,255,255,0.12)",
                borderRadius:999,
                padding:"6px 12px",
                fontSize:12,
                fontWeight:700,
                color:"#fff",
                background:active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
                cursor:"pointer",
                transition:"all 0.15s",
              }}
            >
              {t(option === "english" ? "English" : "Auto-detect")}
            </button>
          );
        })}
      </div>
      <label
        htmlFor={uploadInputId}
        onDrop={e => { e.preventDefault(); handle(e.dataTransfer.files[0]); }}
        onDragOver={e => e.preventDefault()}
        style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", cursor:"pointer", width:"100%", transition:"background 0.2s" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.35)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.25)"}
      >
        <div style={{ fontSize:17, fontWeight:800, color:"#fff", letterSpacing:-0.3 }}>{busy ? t("Reading your chat…") : t("Upload your chat")}</div>
      </label>
      <input id={uploadInputId} type="file" accept=".txt,.zip,text/plain,application/zip" style={{ display:"none" }} onChange={e => handle(e.target.files[0])} />
      {displayErr && <div style={{ fontSize:13, color:"#FFB090", marginTop:8, textAlign:"center", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%" }}>{displayErr}</div>}
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:8, textAlign:"center" }}>{t("Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.")}</div>
      <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap", width:"100%", marginTop:4 }}>
        {onHistory && (
          <button onClick={onHistory} className="wc-btn" style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:999, color:"rgba(255,255,255,0.72)", fontSize:12, cursor:"pointer", padding:"8px 14px", fontWeight:700, letterSpacing:0.1 }}>
            {t("My Results")}
          </button>
        )}
        {showAdminEntry && (
          <button
            onClick={onAdmin}
            className="wc-btn"
            style={{
              background:canAdmin ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
              border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:999,
              color:canAdmin ? "#fff" : "rgba(255,255,255,0.68)",
              fontSize:12,
              cursor:"pointer",
              padding:"8px 14px",
              fontWeight:700,
              letterSpacing:0.1,
            }}
          >
            {t("Feedback Inbox")}
          </button>
        )}
        {onLogout && (
          <button onClick={onLogout} className="wc-btn" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:999, color:"rgba(255,255,255,0.58)", fontSize:12, cursor:"pointer", padding:"8px 14px", fontWeight:700, letterSpacing:0.1 }}>
            {t("Log out")}
          </button>
        )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────
function Loading({ math, reportType }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => Math.min(x+1, LOADING_STEPS.length-1)), 1800); return () => clearInterval(t); }, []);
  const label = REPORT_TYPES.find(r => r.id === reportType)?.label || "Analysis";
  return (
    <Shell sec="upload" prog={tick+1} total={LOADING_STEPS.length}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", textAlign:"center", fontWeight:500 }}>
        {t(label)} · {math.totalMessages.toLocaleString()} {t("messages")}
      </div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"24px 20px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#fff", minHeight:52, letterSpacing:-0.3 }}>{t(LOADING_STEPS[tick])}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:16 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:"rgba(255,255,255,0.4)", animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
        </div>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.25)", textAlign:"center", lineHeight:1.8 }}>
        Your chat is analysed by AI and never stored. Only results are saved.
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// REPORT SELECT
// ─────────────────────────────────────────────────────────────────
const LANG_OPTIONS = [
  { code: "en", label: "English"    },
  { code: "tr", label: "Turkish"    },
  { code: "es", label: "Spanish"    },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic"     },
  { code: "fr", label: "French"     },
  { code: "de", label: "German"     },
  { code: "it", label: "Italian"    },
];

function ReportSelect({ math, onSelect, onBack, chatLang, detectedLang, onLangChange, error = "" }) {
  const t = useT();
  const [langOpen, setLangOpen] = useState(false);

  const isOverridden = detectedLang && chatLang !== detectedLang.code;
  const currentLabel = LANG_OPTIONS.find(l => l.code === chatLang)?.label ?? "English";

  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:28, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>{t("Choose your report")}</div>
      <Sub mt={4}>{math?.totalMessages?.toLocaleString()} {t("messages")} · {math?.names?.slice(0,3).join(", ") || ""}{(math?.names?.length||0)>3?` +${math.names.length-3}`:""}</Sub>
      {error && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{error}</div>}
      {math?.cappedGroup && (
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", background:"rgba(255,255,255,0.08)", borderRadius:14, padding:"8px 14px", width:"100%", textAlign:"center", lineHeight:1.6 }}>
          {t("Large group detected — analysing the top {cap} members out of {count}.", { cap: GROUP_PARTICIPANT_CAP, count: math.originalParticipantCount })}
        </div>
      )}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:6 }}>
        {REPORT_TYPES.map((r) => {
          const pal = PAL[r.palette] || PAL.upload;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className="wc-btn"
              style={{
                background: pal.bg,
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 20,
                padding: "16px 18px",
                textAlign: "left",
                color: "#fff",
                cursor: "pointer",
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, marginBottom:4 }}>{t(r.label)}</div>
              <div style={{ fontSize:12, lineHeight:1.5, color:"rgba(255,255,255,0.58)" }}>{t(r.desc)}</div>
            </button>
          );
        })}
      </div>

      {/* ── Language selector ── */}
      <div style={{ width:"100%", marginTop:4 }}>
        <button
          type="button"
          onClick={() => setLangOpen(v => !v)}
          className="wc-btn"
          style={{
            width:"100%", background:"rgba(255,255,255,0.06)",
            border:"1px solid rgba(255,255,255,0.10)", borderRadius:14,
            padding:"10px 16px", color:"#fff", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            transition:"all 0.15s",
          }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>{t("Report language")}</span>
            <span style={{ fontSize:13, fontWeight:700, color:"#fff" }}>{t(currentLabel)}</span>
            {!isOverridden && detectedLang && (
              <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>{t("auto")}</span>
            )}
            {isOverridden && (
              <span style={{ fontSize:10, color:PAL.upload.accent, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>{t("changed")}</span>
            )}
          </div>
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)", transform: langOpen ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>▾</span>
        </button>

        {langOpen && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8, padding:"4px 0" }}>
            {LANG_OPTIONS.map(opt => {
              const active = chatLang === opt.code;
              return (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => { onLangChange(opt.code); setLangOpen(false); }}
                  className="wc-btn"
                  style={{
                    border: `1px solid ${active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"}`,
                    borderRadius: 50,
                    padding: "7px 14px",
                    fontSize: 13,
                    fontWeight: active ? 800 : 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    background: active ? PAL.upload.inner : "rgba(255,255,255,0.07)",
                    color: "#fff",
                  }}
                >
                  {t(opt.label)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Btn onClick={onBack}>{t("Upload different file")}</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// SLIDE
// ─────────────────────────────────────────────────────────────────
// SLIDE_MS and SLIDE_EASE are defined above Shell, which consumes them.

// Slide is now a thin context provider only.
// Shell consumes SlideContext and animates its content area internally,
// keeping the chrome (background, progress bar, pill, close button) perfectly still.
function Slide({ children, dir, id }) {
  return (
    <SlideContext.Provider value={{ dir, id }}>
      {children}
    </SlideContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────
// SAVE RESULT
// ─────────────────────────────────────────────────────────────────
async function saveResult(type, result, mathData) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const safeMathData = {
      ...mathData,
      evidenceTimeline: mathData.evidenceTimeline?.map(({ date, title }) => ({ date, title })) ?? [],
      redFlags: mathData.redFlags?.map(({ title }) => ({ title })) ?? [],
    };
    const { data, error } = await supabase.from("results").insert({
      user_id:     user.id,
      report_type: type,
      chat_type:   mathData.isGroup ? "group" : "duo",
      names:       mathData.names,
      result_data: result,
      math_data:   safeMathData,
    }).select("id").single();
    if (error) return null;
    return data;
  } catch { return null; /* silent — never interrupt the user flow */ }
}

async function submitFeedback({ resultId, reportType, cardIndex, cardTitle, errorType, errorNote }) {
  try {
    if (!resultId || !reportType || !cardTitle || !errorType) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      result_id: resultId,
      report_type: reportType,
      card_index: cardIndex,
      card_title: cardTitle,
      error_type: errorType,
      error_note: String(errorNote || "").trim() || null,
    });
    return !error;
  } catch { /* silent — never interrupt the user flow */ }
  return false;
}

function pushSummaryRow(rows, label, value, max = null) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text === "—" || text === "..." || text === "…") return;
  rows.push({ label, value: Number.isFinite(max) ? cleanQuote(text, max) : text });
}

function buildFeedbackSummary(feedbackRow, resultRow, viewLang = "en") {
  if (!feedbackRow || !resultRow) return [];
  const math = resultRow.math_data || {};
  const ai = resultRow.result_data || {};
  const rows = [];
  const card = Number(feedbackRow.card_index || 0);
  const isGroup = !!math.isGroup;
  const control = (value) => translateControlValue(viewLang, value);

  if (feedbackRow.report_type === "general") {
    if (!isGroup) {
      if (card === 2) {
        pushSummaryRow(rows, "Ghost", math.ghostName);
        pushSummaryRow(rows, "Reply times", `${math.names?.[0] || "A"} ${math.ghostAvg?.[0] || "—"} • ${math.names?.[1] || "B"} ${math.ghostAvg?.[1] || "—"}`, 90);
        pushSummaryRow(rows, "AI read", ai.ghostContext);
      } else if (card === 5) {
        pushSummaryRow(rows, "Kindest", ai.kindestPerson);
        pushSummaryRow(rows, "Sweetest moment", ai.sweetMoment);
      } else if (card === 8) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson || math.names?.[0]);
        pushSummaryRow(rows, "Reason", ai.funniestReason);
      } else if (card === 14) {
        pushSummaryRow(rows, "Biggest topic", ai.biggestTopic);
        pushSummaryRow(rows, "Tense moment", ai.tensionMoment);
      } else if (card === 15) {
        pushSummaryRow(rows, "Drama starter", ai.dramaStarter);
        pushSummaryRow(rows, "How", ai.dramaContext);
      } else if (card === 16) {
        pushSummaryRow(rows, relReadLabel(ai.relationshipType), ai.relationshipSummary);
      } else if (card === 17) {
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      } else if (card >= DUO_CASUAL_SCREENS + 1) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Drama", ai.dramaStarter);
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      }
    } else {
      if (card === 2) {
        pushSummaryRow(rows, "Ghost", math.ghost);
        pushSummaryRow(rows, "AI read", ai.ghostContext);
      } else if (card === 6) {
        pushSummaryRow(rows, "Hype person", math.hype);
        pushSummaryRow(rows, "Reason", ai.hypePersonReason);
      } else if (card === 7) {
        pushSummaryRow(rows, "Kindest", ai.kindestPerson);
        pushSummaryRow(rows, "Sweetest moment", ai.sweetMoment);
      } else if (card === 8) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Reason", ai.funniestReason);
      } else if (card === 13) {
        pushSummaryRow(rows, "Biggest topic", ai.biggestTopic);
        pushSummaryRow(rows, "Inside joke", ai.insideJoke);
      } else if (card === 14) {
        pushSummaryRow(rows, "Drama starter", ai.dramaStarter);
        pushSummaryRow(rows, "How", ai.dramaContext);
      } else if (card === 15) {
        pushSummaryRow(rows, "Most missed", ai.mostMissed);
      } else if (card === 16) {
        pushSummaryRow(rows, "Group dynamic", ai.groupDynamic);
        pushSummaryRow(rows, "Tense moment", ai.tensionMoment);
      } else if (card === 17) {
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      } else if (card >= GROUP_CASUAL_SCREENS + 1) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Drama", ai.dramaStarter);
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      }
    }
  } else if (feedbackRow.report_type === "toxicity") {
    if (card === 1 || card === 7) {
      pushSummaryRow(rows, "Health score", ai.chatHealthScore != null ? `${ai.chatHealthScore}/10` : "");
      pushSummaryRow(rows, "Verdict", ai.verdict);
    } else if (card === 2) {
      (ai.healthScores || []).slice(0, 3).forEach((item, index) => {
        pushSummaryRow(rows, index === 0 ? "Scores" : " ", `${item.name}: ${item.score}/10 — ${item.detail}`, 120);
      });
    } else if (card === 3) {
      pushSummaryRow(rows, "Apologises more", ai.apologiesLeader?.name);
      pushSummaryRow(rows, "Their context", ai.apologiesLeader?.context);
      pushSummaryRow(rows, "Other context", ai.apologiesOther?.context);
    } else if (card === 4) {
      (ai.redFlagMoments || []).slice(0, 2).forEach((item, index) => {
        pushSummaryRow(rows, index === 0 ? "Flagged moment" : "Another", `${item.person || ""} ${item.date ? `• ${item.date}` : ""} ${item.description || ""} ${item.quote ? `— "${item.quote}"` : ""}`, 130);
      });
    } else if (card === 5) {
      pushSummaryRow(rows, "Conflict pattern", ai.conflictPattern);
    } else if (card === 6) {
      pushSummaryRow(rows, "Power holder", control(ai.powerHolder));
      pushSummaryRow(rows, "Dynamic", ai.powerBalance);
    }
  } else if (feedbackRow.report_type === "lovelang") {
    if (card === 1) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Language", control(ai.personA?.language));
      pushSummaryRow(rows, "Examples", ai.personA?.examples);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Language", control(ai.personB?.language));
      pushSummaryRow(rows, "Examples", ai.personB?.examples);
    } else if (card === 3) {
      pushSummaryRow(rows, "Mismatch", ai.mismatch);
    } else if (card === 4) {
      pushSummaryRow(rows, "Most loving moment", ai.mostLovingMoment);
    } else if (card === 5) {
      pushSummaryRow(rows, "Compatibility", ai.compatibilityScore != null ? `${ai.compatibilityScore}/10` : "");
      pushSummaryRow(rows, "Read", ai.compatibilityRead);
    }
  } else if (feedbackRow.report_type === "growth") {
    if (card === 1) {
      pushSummaryRow(rows, "Early", ai.thenDepth);
      pushSummaryRow(rows, "Recent", ai.nowDepth);
      pushSummaryRow(rows, "Change", control(ai.depthChange));
    } else if (card === 2) {
      pushSummaryRow(rows, "Changed more", ai.whoChangedMore);
      pushSummaryRow(rows, "How", ai.whoChangedHow);
    } else if (card === 3) {
      pushSummaryRow(rows, "Appeared", ai.topicsAppeared);
      pushSummaryRow(rows, "Faded", ai.topicsDisappeared);
    } else if (card === 4) {
      pushSummaryRow(rows, "Trajectory", control(ai.trajectory));
      pushSummaryRow(rows, "Detail", ai.trajectoryDetail);
    } else if (card === 5) {
      pushSummaryRow(rows, "Arc", ai.arcSummary);
    }
  } else if (feedbackRow.report_type === "accounta") {
    if (card === 1) {
      pushSummaryRow(rows, "Promises", `${ai.personA?.name || math.names?.[0] || "A"} ${ai.personA?.total || 0} • ${ai.personB?.name || math.names?.[1] || "B"} ${ai.personB?.total || 0}`, 100);
      pushSummaryRow(rows, "Verdict", ai.overallVerdict);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Score", ai.personA?.score != null ? `${ai.personA.score}/10` : "");
      pushSummaryRow(rows, "Pattern", ai.personA?.detail);
    } else if (card === 3) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Score", ai.personB?.score != null ? `${ai.personB.score}/10` : "");
      pushSummaryRow(rows, "Pattern", ai.personB?.detail);
    } else if (card === 4) {
      pushSummaryRow(rows, "Broken promise", ai.notableBroken?.promise);
      pushSummaryRow(rows, "Outcome", ai.notableBroken?.outcome);
    } else if (card === 5) {
      pushSummaryRow(rows, "Kept promise", ai.notableKept?.promise);
      pushSummaryRow(rows, "Outcome", ai.notableKept?.outcome);
    }
  } else if (feedbackRow.report_type === "energy") {
    if (card === 1 || card === 6) {
      pushSummaryRow(rows, "Scores", `${ai.personA?.name || math.names?.[0] || "A"} ${ai.personA?.netScore ?? "—"}/10 • ${ai.personB?.name || math.names?.[1] || "B"} ${ai.personB?.netScore ?? "—"}/10`, 100);
      pushSummaryRow(rows, "Compatibility", ai.compatibility);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Positive", ai.personA?.goodNews);
      pushSummaryRow(rows, "Draining", ai.personA?.venting);
    } else if (card === 3) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Positive", ai.personB?.goodNews);
      pushSummaryRow(rows, "Draining", ai.personB?.venting);
    } else if (card === 4) {
      pushSummaryRow(rows, "Most energising", ai.mostEnergising);
    } else if (card === 5) {
      pushSummaryRow(rows, "Most draining", ai.mostDraining);
    }
  }

  if (!rows.length) {
    pushSummaryRow(rows, "Reported card", feedbackRow.card_title);
    pushSummaryRow(rows, "Report type", feedbackRow.report_type);
  }

  return rows;
}

function AdminFeedbackInbox({ onBack }) {
  const [rows, setRows] = useState(null);
  const [resultsById, setResultsById] = useState({});
  const [err, setErr] = useState("");
  const [viewLangById, setViewLangById] = useState({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setErr("");
      const { data: feedbackRows, error: feedbackError } = await supabase
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (!alive) return;
      if (feedbackError) {
        setErr("Couldn't load feedback right now.");
        setRows([]);
        return;
      }

      const list = feedbackRows || [];
      setRows(list);
      const resultIds = Array.from(new Set(list.map(item => item.result_id).filter(Boolean)));
      if (!resultIds.length) {
        setResultsById({});
        setViewLangById({});
        return;
      }

      const { data: results, error: resultsError } = await supabase
        .from("results")
        .select("*")
        .in("id", resultIds);

      if (!alive) return;
      if (resultsError) {
        setErr("Couldn't load the related result cards.");
        setResultsById({});
        return;
      }
      setResultsById(Object.fromEntries((results || []).map(row => [row.id, row])));
    };

    load();
    return () => { alive = false; };
  }, []);

  const errorTypeColor = (type) => {
    switch (type) {
      case "Events are mixing":  return { bg:"rgba(240,160,40,0.15)",  border:"rgba(240,160,40,0.3)",  text:"#F0A040" };
      case "Wrong person":       return { bg:"rgba(220,80,60,0.15)",   border:"rgba(220,80,60,0.3)",   text:"#E06060" };
      case "Didn't happen":      return { bg:"rgba(180,60,200,0.15)",  border:"rgba(180,60,200,0.3)",  text:"#C070E0" };
      case "Tone misread":       return { bg:"rgba(60,140,240,0.15)",  border:"rgba(60,140,240,0.3)",  text:"#60A0F0" };
      case "Overclaiming":       return { bg:"rgba(220,80,60,0.15)",   border:"rgba(220,80,60,0.3)",   text:"#E06060" };
      case "Missing context":    return { bg:"rgba(80,160,100,0.15)",  border:"rgba(80,160,100,0.3)",  text:"#60C080" };
      default:                   return { bg:"rgba(255,255,255,0.07)", border:"rgba(255,255,255,0.14)",text:"rgba(255,255,255,0.7)" };
    }
  };

  return (
    <Shell sec="upload" prog={0} total={0}>
      {/* Header */}
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Feedback Inbox
        </div>
        <div
          style={{
            background:"rgba(255,255,255,0.07)",
            border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:999,
            color:"rgba(255,255,255,0.68)",
            fontSize:12,
            padding:"7px 12px",
            fontWeight:700,
            letterSpacing:0.08,
            whiteSpace:"nowrap",
          }}
        >
          {rows === null ? "Loading…" : `${rows.length} report${rows.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {!ADMIN_EMAILS.length && (
        <div style={{ fontSize:12, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", lineHeight:1.6 }}>
          Set <code>VITE_ADMIN_EMAIL</code> in <code>.env</code> to unlock admin access.
        </div>
      )}

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"32px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {rows?.length === 0 && !err && (
        <div style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"32px 20px", textAlign:"center" }}>
          <div style={{ fontSize:28, marginBottom:10 }}>📭</div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", lineHeight:1.6 }}>No feedback yet.</div>
        </div>
      )}

      <div style={{ width:"100%", flex:1, minHeight:0, display:"flex", flexDirection:"column", gap:12, overflowY:"auto", paddingRight:2, paddingBottom:4, alignSelf:"stretch" }}>
        {rows?.map(row => {
          const baseResultRow = resultsById[row.result_id];
          const resultData = baseResultRow?.result_data;
          const translatedLang = getStoredResultDisplayLanguage(resultData);
          const hasTranslation = translatedLang !== "en" && !!getStoredResultTranslations(resultData)?.[translatedLang];
          const selectedLang = hasTranslation ? (viewLangById[row.id] || translatedLang) : "en";
          const englishResultRow = baseResultRow
            ? { ...baseResultRow, result_data: getDisplayResultData(baseResultRow.result_data, "en") }
            : baseResultRow;
          const translatedResultRow = hasTranslation && baseResultRow
            ? { ...baseResultRow, result_data: getDisplayResultData(baseResultRow.result_data, translatedLang) }
            : null;
          const resultRow = selectedLang === "en" || !translatedResultRow ? englishResultRow : translatedResultRow;
          const englishSummaryRows = buildFeedbackSummary(row, englishResultRow, "en");
          const translatedSummaryRows = translatedResultRow ? buildFeedbackSummary(row, translatedResultRow, translatedLang) : [];
          const summaryRows = selectedLang === "en" || !translatedResultRow ? englishSummaryRows : translatedSummaryRows;
          const namesLabel = Array.isArray(baseResultRow?.names) && baseResultRow.names.length
            ? `${baseResultRow.names.slice(0, 3).join(", ")}${baseResultRow.names.length > 3 ? ` +${baseResultRow.names.length - 3}` : ""}`
            : "";
          const messageLabel = baseResultRow?.math_data?.totalMessages != null
            ? `${baseResultRow.math_data.totalMessages.toLocaleString()} msgs`
            : "";
          const submittedAt = row.created_at
            ? new Date(row.created_at).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })
            : "Unknown";
          const tagStyle = errorTypeColor(row.error_type);

          return (
            <div key={row.id} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:22, overflow:"hidden", flexShrink:0 }}>
              {/* top strip */}
              <div style={{ padding:"14px 16px 12px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10 }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:5 }}>
                      {row.report_type} · card {row.card_index} · {submittedAt}
                    </div>
                    <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, lineHeight:1.2, marginBottom: namesLabel || messageLabel ? 5 : 0 }}>
                      {row.card_title || "Untitled card"}
                    </div>
                    {(namesLabel || messageLabel) && (
                      <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>
                        {[namesLabel, messageLabel].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8, flexShrink:0 }}>
                    {hasTranslation && (
                      <div style={{ position:"relative", display:"inline-flex", alignItems:"center", padding:3, borderRadius:999, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.05)" }}>
                        <div
                          style={{
                            position:"absolute",
                            top:3,
                            bottom:3,
                            left: selectedLang === "en" ? 3 : "calc(50% + 1.5px)",
                            width:"calc(50% - 3px)",
                            borderRadius:999,
                            background:"rgba(255,255,255,0.14)",
                            transition:"left 0.18s ease",
                          }}
                        />
                        {[
                          { code: "en", label: "English" },
                          { code: translatedLang, label: LANG_META[translatedLang] || translatedLang.toUpperCase() },
                        ].map(opt => (
                          <button
                            key={`${row.id}-${opt.code}`}
                            type="button"
                            onClick={() => setViewLangById(prev => ({ ...prev, [row.id]: opt.code }))}
                            className="wc-btn"
                            style={{
                              position:"relative",
                              zIndex:1,
                              minWidth:74,
                              border:"none",
                              background:"transparent",
                              color: selectedLang === opt.code ? "#fff" : "rgba(255,255,255,0.52)",
                              fontSize:11,
                              fontWeight:800,
                              letterSpacing:"0.04em",
                              padding:"7px 12px",
                              cursor:"pointer",
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ background:tagStyle.bg, border:`1px solid ${tagStyle.border}`, borderRadius:999, padding:"5px 11px", fontSize:12, fontWeight:700, color:tagStyle.text, whiteSpace:"nowrap" }}>
                      {row.error_type || "Other"}
                    </div>
                  </div>
                </div>
              </div>

              {/* body */}
              <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                {/* user's note */}
                {row.error_note && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:5 }}>Note</div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.82)", lineHeight:1.6 }}>{row.error_note}</div>
                  </div>
                )}

                {/* model output */}
                {summaryRows.length > 0 && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:8 }}>What was shown</div>
                    {translatedResultRow ? (
                      <div style={{ display:"grid" }}>
                        {[
                          { code: "en", rows: englishSummaryRows },
                          { code: translatedLang, rows: translatedSummaryRows },
                        ].map(group => (
                          <div
                            key={`${row.id}-${group.code}`}
                            style={{
                              gridArea:"1 / 1",
                              display:"flex",
                              flexDirection:"column",
                              gap:7,
                              opacity: selectedLang === group.code ? 1 : 0,
                              visibility: selectedLang === group.code ? "visible" : "hidden",
                              pointerEvents: selectedLang === group.code ? "auto" : "none",
                            }}
                          >
                            {group.rows.map((item, index) => (
                              <div key={`${group.code}-${item.label}-${index}`}>
                                <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{item.label}</div>
                                <div style={{ fontSize:13, color:"#fff", lineHeight:1.55, fontWeight:500 }}>{item.value}</div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                        {summaryRows.map((item, index) => (
                          <div key={`${item.label}-${index}`}>
                            <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{item.label}</div>
                            <div style={{ fontSize:13, color:"#fff", lineHeight:1.55, fontWeight:500 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!row.error_note && !summaryRows.length && (
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)", fontStyle:"italic" }}>No note or saved output for this card.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Btn onClick={onBack}>← Back</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// MY RESULTS
// ─────────────────────────────────────────────────────────────────
function MyResults({ onBack, onRestoreResult }) {
  const [rows,          setRows]          = useState(null);
  const [err,           setErr]           = useState("");
  const [editing,       setEditing]       = useState(false);
  const [confirmId,     setConfirmId]     = useState(null); // row.id awaiting confirm
  const [deletingId,    setDeletingId]    = useState(null); // row.id mid-delete

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRows([]); return; }
      const { data, error } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) setErr("Couldn't load results. Try again.");
      else setRows(data || []);
    });
  }, []);

  const exitEditing = () => { setEditing(false); setConfirmId(null); };

  const handleDelete = async (id) => {
    setDeletingId(id);
    setConfirmId(null);
    try {
      const { error } = await supabase.from("results").delete().eq("id", id);
      if (!error) {
        setRows(prev => prev.filter(r => r.id !== id));
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingId(null);
  };

  const headline = (row) => {
    const displayLang = getStoredResultDisplayLanguage(row.result_data);
    const ai   = getDisplayResultData(row.result_data, displayLang);
    const math = row.math_data   || {};
    switch (row.report_type) {
      case "general":  return `${(math.totalMessages || 0).toLocaleString()} messages`;
      case "toxicity": return chatHealthLabel(ai.chatHealthScore) || math.toxicityLevel || "—";
      case "lovelang": return ai.compatibilityScore != null ? `${ai.compatibilityScore}/10 compatibility` : "—";
      case "growth":   return translateControlValue(displayLang, ai.trajectory) || "—";
      case "accounta": return ai.overallVerdict || "—";
      case "energy":   return ai.compatibility  || "—";
      default:         return "—";
    }
  };

  return (
    <Shell sec="upload" prog={0} total={0}>
      {/* Header row — title + Edit/Done */}
      <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"flex-end", width:"100%", minHeight:36 }}>
        <div style={{ position:"absolute", left:"50%", transform:"translateX(-50%)", fontSize:28, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1, textAlign:"center", pointerEvents:"none", whiteSpace:"nowrap" }}>
          My Results
        </div>
        {rows?.length > 0 && (
          <button
            type="button"
            onClick={() => editing ? exitEditing() : setEditing(true)}
            className="wc-btn"
            style={{
              background: editing ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 50,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              cursor: "pointer",
              transition: "all 0.15s",
              letterSpacing: 0.1,
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {!editing && <Sub mt={2}>Tap any result to view it again.</Sub>}
      {editing  && <Sub mt={2}>Tap the × to delete a result.</Sub>}

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {rows?.length === 0 && (
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.38)", textAlign:"center", padding:"24px 0", lineHeight:1.6 }}>No saved results yet.<br/>Run an analysis to see it here.</div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, maxHeight:"58vh", overflowY:"auto", paddingRight:2 }}>
        {rows?.map(row => {
          const rt      = REPORT_TYPES.find(r => r.id === row.report_type);
          const pal     = PAL[rt?.palette] || PAL.upload;
          const names   = Array.isArray(row.names) ? row.names.slice(0, 3).join(", ") + (row.names.length > 3 ? ` +${row.names.length - 3}` : "") : "—";
          const date    = new Date(row.created_at).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
          const stat    = headline(row);
          const isDeleting = deletingId === row.id;
          const isConfirming = confirmId === row.id;

          const cardContent = (
            <>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:4 }}>{rt?.label || row.report_type} · {date}</div>
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, marginBottom:3 }}>{names}</div>
              {stat !== "—" && <div style={{ fontSize:12, fontWeight:600, color:pal.accent }}>{stat}</div>}
            </>
          );

          if (!editing) {
            return (
              <button key={row.id} onClick={() => onRestoreResult(row)} className="wc-btn"
                style={{ background:pal.bg, border:"1px solid rgba(255,255,255,0.14)", borderRadius:20, padding:"14px 18px", textAlign:"left", color:"#fff", cursor:"pointer", width:"100%", transition:"all 0.15s", position:"relative" }}
              >
                {cardContent}
              </button>
            );
          }

          // ── Edit mode card ──
          return (
            <div key={row.id}
              style={{ background:pal.bg, border:`1px solid ${isConfirming ? "rgba(220,50,50,0.5)" : "rgba(255,255,255,0.14)"}`, borderRadius:20, padding:"14px 18px", color:"#fff", width:"100%", position:"relative", transition:"border-color 0.15s" }}
            >
              {/* Dimmed card body */}
              <div style={{ opacity: isDeleting || isConfirming ? 0.35 : 0.65, pointerEvents:"none", transition:"opacity 0.15s" }}>
                {cardContent}
              </div>

              {/* Delete button — top-right */}
              {!isConfirming && !isDeleting && (
                <button
                  type="button"
                  onClick={() => setConfirmId(row.id)}
                  className="wc-btn"
                  style={{
                    position:"absolute", top:10, right:10,
                    width:28, height:28, borderRadius:"50%",
                    background:"rgba(200,40,40,0.85)",
                    border:"1.5px solid rgba(255,100,100,0.5)",
                    color:"#fff", fontSize:14, fontWeight:800,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer", lineHeight:1, padding:0,
                    transition:"all 0.15s",
                  }}
                  aria-label="Delete result"
                >
                  ×
                </button>
              )}

              {/* Deleting spinner */}
              {isDeleting && (
                <div style={{ position:"absolute", top:0, left:0, right:0, bottom:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}>
                  <Dots />
                </div>
              )}

              {/* Inline confirmation */}
              {isConfirming && !isDeleting && (
                <div style={{ position:"absolute", top:0, left:0, right:0, bottom:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center", lineHeight:1.4 }}>Delete this result?</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id)}
                      className="wc-btn"
                      style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:50, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer", transition:"all 0.15s" }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="wc-btn"
                      style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:50, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", transition:"all 0.15s" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Btn onClick={() => { exitEditing(); onBack(); }}>← Back</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────
export default function App({ pendingImportedChat = null, onPendingImportedChatConsumed = () => {} }) {
  const [phase,            setPhase]            = useState("auth");
  const [authedUser,       setAuthedUser]       = useState(null);
  const [messages,         setMessages]         = useState(null);
  const [math,             setMath]             = useState(null);
  const [ai,               setAi]               = useState(null);
  const [coreAnalysisA,    setCoreAnalysisA]    = useState(null);
  const [coreAnalysisAKey, setCoreAnalysisAKey] = useState("");
  const [coreAnalysisB,    setCoreAnalysisB]    = useState(null);
  const [coreAnalysisBKey, setCoreAnalysisBKey] = useState("");
  const [aiLoading,        setAiLoading]        = useState(false);
  const [reportType,       setReportType]       = useState(null);
  const [relationshipType, setRelationshipType] = useState(null);
  const [chatLang,         setChatLang]         = useState("en");  // detected or user-selected
  const [detectedLang,     setDetectedLang]     = useState(null);  // { code, label, confidence }
  const [uiLangPref,       setUiLangPref]       = useState("english");
  const [step,             setStep]             = useState(0);
  const [dir,              setDir]              = useState("fwd");
  const [sid,              setSid]              = useState(0);
  const [resultsOrigin,    setResultsOrigin]    = useState("upload"); // "upload" | "history"
  const [shareBusy,        setShareBusy]        = useState(false);
  const [sharePicker,      setSharePicker]      = useState(false);
  const [currentResultId,  setCurrentResultId]  = useState(null);
  const [feedbackTarget,   setFeedbackTarget]   = useState(null);
  const [feedbackChoice,   setFeedbackChoice]   = useState("");
  const [feedbackNote,     setFeedbackNote]     = useState("");
  const [feedbackBusy,     setFeedbackBusy]     = useState(false);
  const [feedbackThanks,   setFeedbackThanks]   = useState(false);
  const [uploadError,      setUploadError]      = useState("");
  const [analysisError,    setAnalysisError]    = useState("");
  const consumedImportRef = useRef(null);
  const resolvedUiLang = resolveUiLang(uiLangPref, detectedLang?.code);

  useEffect(() => {
    setUiLangPref(normalizeUiLangPref(authedUser?.user_metadata?.ui_language));
  }, [authedUser]);

  const updateUiLangPref = async (pref) => {
    const nextPref = normalizeUiLangPref(pref);
    setUiLangPref(nextPref);
    setAuthedUser(prev => (
      prev
        ? { ...prev, user_metadata: { ...(prev.user_metadata || {}), ui_language: nextPref } }
        : prev
    ));
    try {
      const { data } = await supabase.auth.updateUser({ data: { ui_language: nextPref } });
      if (data?.user) setAuthedUser(data.user);
    } catch {
      // Silent: preference changes should never interrupt the user flow.
    }
  };

  // Keep a ref so the visibilitychange handler always sees the current phase
  // without being re-registered on every render.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    if (!feedbackThanks) return undefined;
    const t = setTimeout(() => setFeedbackThanks(false), 2000);
    return () => clearTimeout(t);
  }, [feedbackThanks]);

  useEffect(() => {
    if (!messages?.length) return;
    if (math?.analysisVersion === LOCAL_STATS_VERSION) return;

    try {
      const refreshed = localStats(messages);
      if (!refreshed) return;
      refreshed.cappedGroup = math?.cappedGroup ?? refreshed.cappedGroup;
      refreshed.originalParticipantCount = math?.originalParticipantCount ?? refreshed.originalParticipantCount;
      setMath(refreshed);
      setCurrentResultId(null);
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } catch (error) {
      console.error("Local stats refresh failed", error);
    }
  }, [math, messages]);

  // When the tab becomes visible again while stuck on the loading screen,
  // check if a result was already saved (e.g. the fetch completed in the
  // background) and restore it without asking the user to re-upload.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      if (phaseRef.current !== "loading") return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setAuthedUser(user);

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", tenMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) return;

      const displayLang = getStoredResultDisplayLanguage(data.result_data);
      const displayResult = getDisplayResultData(data.result_data, displayLang);
      const canReuseCore = data.result_data?.analysisCacheVersion === CORE_ANALYSIS_CACHE_VERSION;

      setAi(displayResult || {});
      if (canReuseCore && data.result_data?.coreAnalysis?.part === "a") {
        setCoreAnalysisA(data.result_data.coreAnalysis);
        setCoreAnalysisAKey(getCoreAnalysisCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, "en"));
      } else if (canReuseCore && data.result_data?.coreAnalysis?.part === "b") {
        setCoreAnalysisB(data.result_data.coreAnalysis);
        setCoreAnalysisBKey(getCoreAnalysisCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, "en"));
      } else {
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      }
      setMath(data.math_data || null);
      setReportType(data.report_type || null);
      setCurrentResultId(data.id || null);
      setRelationshipType(displayResult?.relationshipType ?? null);
      setChatLang(displayLang);
      setAiLoading(false);
      setStep(0);
      setDir("fwd");
      setResultsOrigin("upload");
      setPhase("results");
      setSid(s => s + 1);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []); // registered once — reads phase via phaseRef

  // Check for an existing session on mount and listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthedUser(session?.user || null);
      if (session?.user) {
        setStep(0);
        setDir("fwd");
        setPhase(postAuthPhaseForUser(session.user));
        setSid(s => s + 1);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthedUser(session?.user || null);
      if (session?.user) {
        setStep(0);
        setDir("fwd");
        setPhase(postAuthPhaseForUser(session.user));
        setSid(s => s + 1);
      } else {
        setStep(0);
        setDir("fwd");
        setPhase("auth");
        setSid(s => s + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  // Called when onboarding completes → proceed to terms acceptance
  const onOnboarded = (pref = "english") => {
    const nextPref = normalizeUiLangPref(pref);
    setUiLangPref(nextPref);
    setAuthedUser(prev => (
      prev
        ? { ...prev, user_metadata: { ...(prev.user_metadata || {}), has_onboarded: true, ui_language: nextPref } }
        : prev
    ));
    setStep(0);
    setDir("fwd");
    setPhase("terms");
    setSid(s => s + 1);
  };

  // Called when terms are accepted → proceed to upload
  const onAcceptedTerms = () => {
    setUploadError("");
    setAnalysisError("");
    setStep(0);
    setDir("fwd");
    setPhase("upload");
    setSid(s => s + 1);
  };

  const go      = d => { setDir(d); setSid(s => s+1); setStep(s => d==="fwd" ? s+1 : s-1); };
  const back    = () => go("bk");
  const next    = () => go("fwd");
  const restart = () => {
    setPhase("upload"); setMessages(null); setMath(null); setAi(null);
    setCoreAnalysisA(null); setCoreAnalysisAKey("");
    setCoreAnalysisB(null); setCoreAnalysisBKey("");
    setAiLoading(false); setReportType(null); setRelationshipType(null);
    setCurrentResultId(null);
    setFeedbackTarget(null); setFeedbackChoice(""); setFeedbackNote(""); setFeedbackBusy(false); setFeedbackThanks(false);
    setChatLang("en"); setDetectedLang(null);
    setUploadError("");
    setAnalysisError("");
    setStep(0); setDir("fwd"); setSid(s => s+1);
  };

  // Step 1: file parsed → check thresholds, cap large groups, compute local stats, detect language
  const onParsed = ({ messages: msgs, tooShort }) => {
    setUploadError("");
    setAnalysisError("");
    if (tooShort) {
      setPhase("tooshort");
      setSid(s => s + 1);
      return;
    }
    // Yield to the browser's render cycle so "Reading your chat…" appears
    // before the heavy synchronous computation blocks the main thread.
    setTimeout(() => {
      try {
        const { messages: cappedMsgs, cappedGroup, originalParticipantCount } = capLargeGroup(msgs);
        const m = localStats(cappedMsgs);
        if (m) {
          m.cappedGroup = cappedGroup;
          m.originalParticipantCount = originalParticipantCount;
        }
        const detected = detectLanguage(cappedMsgs);
        setDetectedLang(detected);
        setChatLang(detected.code);
        setMessages(cappedMsgs);
        setMath(m);
        setAi(null);
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
        setRelationshipType(null);
        setCurrentResultId(null);
        setPhase("select");
        setSid(s => s+1);
      } catch (error) {
        console.error("Post-parse analysis failed", error);
        setMessages(null);
        setMath(null);
        setDetectedLang(null);
        setUploadError("Couldn't finish reading this chat. Try exporting again or using a shorter date range.");
        setPhase("upload");
        setSid(s => s + 1);
      }
    }, 0);
  };

  useEffect(() => {
    if (!pendingImportedChat?.id || !pendingImportedChat.payload) return;
    if (consumedImportRef.current === pendingImportedChat.id) return;
    if (!authedUser || phase !== "upload") return;

    consumedImportRef.current = pendingImportedChat.id;
    onParsed(pendingImportedChat.payload);
    onPendingImportedChatConsumed(pendingImportedChat.id);
  }, [authedUser, onPendingImportedChatConsumed, pendingImportedChat, phase]);

  const generatePipelineResult = async (type, relType) => {
    const pipeline = REPORT_PIPELINES[type];
    if (pipeline?.strategy !== "core") return {};

    const cacheKey = getCoreAnalysisCacheKey(math, relType, "en");
    const useCoreA = pipeline.cache === "a";
    let core = useCoreA
      ? (coreAnalysisAKey === cacheKey ? coreAnalysisA : null)
      : (coreAnalysisBKey === cacheKey ? coreAnalysisB : null);

    if (!core) {
      core = useCoreA
        ? await generateCoreAnalysisA(messages, math, relType, "en")
        : await generateCoreAnalysisB(messages, math, relType, "en");
      if (useCoreA) {
        setCoreAnalysisA(core);
        setCoreAnalysisAKey(cacheKey);
      } else {
        setCoreAnalysisB(core);
        setCoreAnalysisBKey(cacheKey);
      }
    }

    const derived = pipeline.derive(core, math, relType);
    if (!hasMeaningfulAnalysisResult(type, derived)) {
      throw new Error("AI returned an empty analysis");
    }
    return derived;
  };

  // Run AI analysis with the selected report type and relationship type
  const runAnalysis = async (type, relType) => {
    setAnalysisError("");
    setStep(0);
    setPhase("loading");
    setSid(s => s+1);
    setAiLoading(true);
    setAi(null);
    setCurrentResultId(null);
    let result = null;
    try {
      const canonicalResult = await generatePipelineResult(type, relType);
      let translationOverlay = null;
      if (chatLang !== "en") {
        try {
          translationOverlay = await translateResultOverlay(type, canonicalResult, chatLang);
        } catch (translationError) {
          console.error(`Translation failed for report "${type}" [lang=${chatLang}]`, translationError);
        }
      }
      result = buildStoredResultData(canonicalResult, translationOverlay ? chatLang : "en", translationOverlay);
    } catch (error) {
      console.error(`Analysis failed for report "${type}" [lang=${chatLang}]`, error);
      const fallbackPhase = math?.isGroup ? "select" : "relationship";
      const msg = String(error?.message || "").includes("timed out")
        ? "The AI took too long to answer. Please try again."
        : "The AI analysis didn't come through. Please try again.";
      setAnalysisError(msg);
      setAiLoading(false);
      setPhase(fallbackPhase);
      setStep(0);
      setSid(s => s + 1);
      return;
    }
    const displayLang = result ? getStoredResultDisplayLanguage(result) : "en";
    if (!result) {
      setAnalysisError("The AI analysis didn't return a usable result. Please try again.");
      setAiLoading(false);
      setPhase(math?.isGroup ? "select" : "relationship");
      setStep(0);
      setSid(s => s + 1);
      return;
    }
    setAi(getDisplayResultData(result, displayLang));
    const saved = await saveResult(type, result, math);
    setCurrentResultId(saved?.id || null);
    setAiLoading(false);
    setResultsOrigin("upload");
    setPhase("results");
    setStep(0);
    setSid(s => s+1);
  };

  // Step 2: user picks a report → for duo chats, show relationship screen first
  const onSelectReport = (type) => {
    setAnalysisError("");
    setReportType(type);
    if (!math.isGroup) {
      setPhase("relationship");
      setSid(s => s+1);
    } else {
      runAnalysis(type, null);
    }
  };

  // Step 3 (duo only): user picks relationship type → run analysis
  const onSelectRelationship = (relType) => {
    setAnalysisError("");
    setRelationshipType(relType);
    runAnalysis(reportType, relType);
  };

  const closeResults = () => {
    const dest = resultsOrigin === "history" ? "history" : "upload";
    setPhase(dest);
    setSid(s => s + 1);
  };

  const openFeedback = (target) => {
    setFeedbackTarget(target);
    setFeedbackChoice("");
    setFeedbackNote("");
  };

  const closeFeedback = (force = false) => {
    if (feedbackBusy && !force) return;
    setFeedbackTarget(null);
    setFeedbackChoice("");
    setFeedbackNote("");
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackTarget || !feedbackChoice || feedbackBusy) return;
    setFeedbackBusy(true);
    const ok = await submitFeedback({
      resultId: feedbackTarget.resultId,
      reportType: feedbackTarget.reportType,
      cardIndex: feedbackTarget.cardIndex,
      cardTitle: feedbackTarget.cardTitle,
      errorType: feedbackChoice,
      errorNote: feedbackNote,
    });
    setFeedbackBusy(false);
    closeFeedback(true);
    if (ok) setFeedbackThanks(true);
  };
  const captureScreen = async (filename) => {
    if (shareBusy) return;
    setShareBusy(true);
    setSharePicker(false);
    let blob = null;
    try {
      const el = document.querySelector(".wc-root");
      if (!el) return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await html2canvas(el, {
        backgroundColor: null,
        scale: window.devicePixelRatio || 2,
        useCORS: true,
        logging: false,
      });
      blob = await canvasToBlob(canvas);
      const file = typeof File === "function"
        ? new File([blob], filename, { type: "image/png" })
        : null;
      if (file && canShareFiles([file])) {
        await navigator.share({ files: [file], title: "WrapChat" });
      } else {
        downloadBlob(blob, filename);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        if (blob) downloadBlob(blob, filename);
        console.error("Screen capture failed", error);
      }
    } finally {
      setShareBusy(false);
    }
  };

  const wrap = child => (
    <UILanguageContext.Provider value={{ uiLang: resolvedUiLang, uiLangPref, updateUiLangPref }}>
      <ShareResultsContext.Provider value={{ onShare: () => setSharePicker(true), busy: shareBusy }}>
        <FeedbackContext.Provider value={{ openFeedback }}>
          <>
            <div style={{ width:"min(420px, 100vw)", margin:"0 auto", overflow:"hidden" }}>
              <Slide dir={dir} id={sid}>
                <CloseResultsContext.Provider value={closeResults}>
                  {child}
                </CloseResultsContext.Provider>
              </Slide>
            </div>
            <SharePicker
              open={sharePicker}
              busy={shareBusy}
              onCard={() => captureScreen(`wrapchat-${reportType || "general"}-card.png`)}
              onSummary={() => captureScreen(`wrapchat-${reportType || "general"}-summary.png`)}
              onClose={() => setSharePicker(false)}
            />
            <FeedbackSheet
              open={!!feedbackTarget}
              target={feedbackTarget}
              selected={feedbackChoice}
              note={feedbackNote}
              submitting={feedbackBusy}
              onSelect={setFeedbackChoice}
              onNoteChange={setFeedbackNote}
              onSubmit={handleSubmitFeedback}
              onClose={closeFeedback}
            />
            {feedbackThanks && (
              <div style={{ position:"fixed", left:"50%", bottom:32, transform:"translateX(-50%)", zIndex:210, background:"rgba(20,20,28,0.96)", border:"1px solid rgba(255,255,255,0.14)", color:"#fff", padding:"11px 20px", borderRadius:999, fontSize:13, fontWeight:700, letterSpacing:"0.02em", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:15 }}>✓</span> {translateUI(resolvedUiLang, "Got it, thank you.")}
              </div>
            )}
          </>
        </FeedbackContext.Provider>
      </ShareResultsContext.Provider>
    </UILanguageContext.Provider>
  );

  const withUiLanguage = (node) => (
    <UILanguageContext.Provider value={{ uiLang: resolvedUiLang, uiLangPref, updateUiLangPref }}>
      {node}
    </UILanguageContext.Provider>
  );

  const onRestoreResult = (row) => {
    setMath(row.math_data);
    const displayLang = getStoredResultDisplayLanguage(row.result_data);
    const canReuseCore = row.result_data?.analysisCacheVersion === CORE_ANALYSIS_CACHE_VERSION;
    setAi(getDisplayResultData(row.result_data, displayLang));
    if (canReuseCore && row.result_data?.coreAnalysis?.part === "a") {
      setCoreAnalysisA(row.result_data.coreAnalysis);
      setCoreAnalysisAKey(getCoreAnalysisCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, "en"));
    } else if (canReuseCore && row.result_data?.coreAnalysis?.part === "b") {
      setCoreAnalysisB(row.result_data.coreAnalysis);
      setCoreAnalysisBKey(getCoreAnalysisCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, "en"));
    } else {
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    }
    setReportType(row.report_type);
    setCurrentResultId(row.id || null);
    setRelationshipType(row.result_data?.relationshipType ?? null);
    setChatLang(displayLang);
    setAiLoading(false);
    setStep(0);
    setDir("fwd");
    setResultsOrigin("history");
    setPhase("results");
    setSid(s => s + 1);
  };

  if (phase === "auth")     return withUiLanguage(<Slide dir="fwd" id={sid}><Auth /></Slide>);
  if (phase === "onboarding") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <OnboardingFlow step={step} next={next} onOnboarded={onOnboarded} onLogout={logout} />
    </Slide>)
  );
  if (phase === "terms") return (
    withUiLanguage(<Slide dir="fwd" id={sid}>
      <TermsFlow onAccepted={onAcceptedTerms} onLogout={logout} />
    </Slide>)
  );
  if (phase === "admin") return (
    withUiLanguage(<Slide dir="fwd" id={sid}>
      {isAdminUser(authedUser)
        ? <AdminFeedbackInbox onBack={() => { setPhase("upload"); setSid(s => s+1); }} onLogout={logout} />
        : <AdminLocked onBack={() => { setPhase("upload"); setSid(s => s+1); }} />}
    </Slide>)
  );
  if (phase === "history")  return withUiLanguage(<Slide dir="fwd" id={sid}><MyResults onBack={() => { setPhase("upload"); setSid(s => s+1); }} onRestoreResult={onRestoreResult} /></Slide>);
  if (phase === "upload")   return withUiLanguage(<Slide dir="fwd" id={sid}><Upload onParsed={onParsed} onLogout={logout} onHistory={() => { setPhase("history"); setSid(s => s+1); }} onAdmin={() => { setPhase("admin"); setSid(s => s+1); }} canAdmin={isAdminUser(authedUser)} uploadError={uploadError} onClearError={() => setUploadError("")} /></Slide>);
  if (phase === "tooshort") return withUiLanguage(<Slide dir="fwd" id={sid}><TooShort onBack={() => { setPhase("upload"); setSid(s => s+1); }} /></Slide>);
  if (phase === "select") return (
    withUiLanguage(<Slide dir="fwd" id={sid}>
      <ReportSelect
        math={math}
        onSelect={onSelectReport}
        onBack={() => { setAnalysisError(""); setPhase("upload"); setSid(s => s+1); }}
        chatLang={chatLang}
        detectedLang={detectedLang}
        onLangChange={code => { setAnalysisError(""); setChatLang(code); setCoreAnalysisA(null); setCoreAnalysisAKey(""); setCoreAnalysisB(null); setCoreAnalysisBKey(""); }}
        error={analysisError}
      />
    </Slide>)
  );
  if (phase === "relationship") return (
    withUiLanguage(<Slide dir="fwd" id={sid}>
      <RelationshipSelect onSelect={onSelectRelationship} onBack={() => { setAnalysisError(""); setPhase("select"); setSid(s => s+1); }} error={analysisError} />
    </Slide>)
  );
  if (phase === "loading") return withUiLanguage(<Loading math={math} reportType={reportType} />);

  // ── Premium report routing ──
  if (reportType === "toxicity") {
    if (step < TOXICITY_SCREENS) return wrap(<ToxicityReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} resultId={currentResultId} />);
  }
  if (reportType === "lovelang") {
    if (step < LOVELANG_SCREENS) return wrap(<LoveLangReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} resultId={currentResultId} />);
  }
  if (reportType === "growth") {
    if (step < GROWTH_SCREENS) return wrap(<GrowthReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} resultId={currentResultId} />);
  }
  if (reportType === "accounta") {
    if (step < ACCOUNTA_SCREENS) return wrap(<AccountaReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} resultId={currentResultId} />);
  }
  if (reportType === "energy") {
    if (step < ENERGY_SCREENS) return wrap(<EnergyReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} resultId={currentResultId} />);
  }

  // ── General Wrapped (existing casual analysis) ──
  const contentCount = math.isGroup ? GROUP_CASUAL_SCREENS : DUO_CASUAL_SCREENS;
  const total = contentCount + 1;
  let screen;
  if (step < contentCount) {
    screen = math.isGroup
      ? <GroupScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} mode="casual" resultId={currentResultId} />
      : <DuoScreen   s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} mode="casual" relationshipType={relationshipType} resultId={currentResultId} />;
  } else {
    screen = <Finale s={math} ai={ai} aiLoading={aiLoading} restart={restart} back={back} prog={total} total={total} mode="casual" resultId={currentResultId} />;
  }
  return wrap(screen);
}
