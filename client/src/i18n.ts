import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Minimal i18n setup: only the Coach "waiting for response" copy is localized so far, keyed
// off the same language codes as LANGUAGES in config.ts (used for the AI's answer language).
// Translations below are a first draft, not reviewed by a native speaker of each language.
void i18next.use(initReactI18next).init({
  fallbackLng: 'en',
  lng: 'en',
  defaultNS: 'coach',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      coach: {
        waitingDefault: 'Preparing practical advice for you…',
        waitingStillWorking: 'Still working — a good answer takes a moment.',
        waitingLonger: 'This is taking longer than usual.',
      },
    },
    hi: {
      coach: {
        waitingDefault: 'आपके लिए व्यावहारिक सलाह तैयार की जा रही है…',
        waitingStillWorking: 'अभी भी काम चल रहा है — एक अच्छे उत्तर में थोड़ा समय लगता है।',
        waitingLonger: 'इसमें सामान्य से अधिक समय लग रहा है।',
      },
    },
    bn: {
      coach: {
        waitingDefault: 'আপনার জন্য ব্যবহারিক পরামর্শ তৈরি করা হচ্ছে…',
        waitingStillWorking: 'এখনও কাজ চলছে — একটি ভালো উত্তর তৈরি করতে কিছুটা সময় লাগে।',
        waitingLonger: 'এটি স্বাভাবিকের চেয়ে বেশি সময় নিচ্ছে।',
      },
    },
    te: {
      coach: {
        waitingDefault: 'మీ కోసం ప్రాక్టికల్ సలహా తయారు చేయబడుతోంది…',
        waitingStillWorking: 'ఇంకా పని జరుగుతోంది — మంచి సమాధానానికి కొంత సమయం పడుతుంది.',
        waitingLonger: 'ఇది సాధారణం కంటే ఎక్కువ సమయం తీసుకుంటోంది.',
      },
    },
    mr: {
      coach: {
        waitingDefault: 'तुमच्यासाठी व्यावहारिक सल्ला तयार केला जात आहे…',
        waitingStillWorking: 'अजूनही काम चालू आहे — चांगल्या उत्तरासाठी थोडा वेळ लागतो.',
        waitingLonger: 'यासाठी नेहमीपेक्षा जास्त वेळ लागत आहे.',
      },
    },
    ta: {
      coach: {
        waitingDefault: 'உங்களுக்கான நடைமுறை ஆலோசனை தயாரிக்கப்படுகிறது…',
        waitingStillWorking: 'இன்னும் வேலை நடந்து கொண்டிருக்கிறது — ஒரு நல்ல பதிலுக்கு சிறிது நேரம் ஆகும்.',
        waitingLonger: 'இதற்கு வழக்கத்தை விட அதிக நேரம் ஆகிறது.',
      },
    },
    gu: {
      coach: {
        waitingDefault: 'તમારા માટે વ્યવહારુ સલાહ તૈયાર કરવામાં આવી રહી છે…',
        waitingStillWorking: 'હજુ પણ કામ ચાલુ છે — સારા જવાબ માટે થોડો સમય લાગે છે.',
        waitingLonger: 'આમાં સામાન્ય કરતાં વધુ સમય લાગી રહ્યો છે.',
      },
    },
    kn: {
      coach: {
        waitingDefault: 'ನಿಮಗಾಗಿ ಪ್ರಾಯೋಗಿಕ ಸಲಹೆಯನ್ನು ತಯಾರಿಸಲಾಗುತ್ತಿದೆ…',
        waitingStillWorking: 'ಇನ್ನೂ ಕೆಲಸ ನಡೆಯುತ್ತಿದೆ — ಉತ್ತಮ ಉತ್ತರಕ್ಕೆ ಸ್ವಲ್ಪ ಸಮಯ ಬೇಕಾಗುತ್ತದೆ.',
        waitingLonger: 'ಇದು ಸಾಮಾನ್ಯಕ್ಕಿಂತ ಹೆಚ್ಚು ಸಮಯ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದೆ.',
      },
    },
    or: {
      coach: {
        waitingDefault: 'ଆପଣଙ୍କ ପାଇଁ ବ୍ୟବହାରିକ ପରାମର୍ଶ ପ୍ରସ୍ତୁତ କରାଯାଉଛି…',
        waitingStillWorking: 'ଏପର୍ଯ୍ୟନ୍ତ କାମ ଚାଲୁଛି — ଏକ ଭଲ ଉତ୍ତର ପାଇଁ କିଛି ସମୟ ଲାଗେ।',
        waitingLonger: 'ଏହା ସାଧାରଣ ଠାରୁ ଅଧିକ ସମୟ ନେଉଛି।',
      },
    },
    hinglish: {
      coach: {
        waitingDefault: 'Aapke liye practical advice taiyaar ki ja rahi hai…',
        waitingStillWorking: 'Kaam abhi bhi chal raha hai — ek achha jawab dene mein thoda time lagta hai.',
        waitingLonger: 'Isme normal se zyada time lag raha hai.',
      },
    },
  },
});

export default i18next;
