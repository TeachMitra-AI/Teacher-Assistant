import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Sun,
  Moon,
  Menu,
  X,
  Sparkles,
  ChevronDown,
  CircleHelp,
  GraduationCap,
  MessageCircleQuestion,
  Languages,
  ClipboardCheck,
  Library,
  Check,
  Plus,
  Mic,
  ArrowUp,
  Search,
  PanelLeft,
  Smartphone,
} from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useJsonLd } from '../hooks/useJsonLd';
import AuthModal from '../components/AuthModal';
import type { Mode } from '../components/AuthForm';
import { FooterSeoColumns } from '../components/PublicSiteChrome';
import { SocialLinks } from '../components/SocialLinks';
import { AnnouncementBar } from '../components/AnnouncementBar';
import { ProductShot } from '../components/ProductShot';
import { buildHomeGraph } from '../seo/schema';
import { ABOUT_PAGE, GUIDE_PAGES, TOOL_PAGES } from '../seo/pages';

// Public marketing landing page shown at "/" to signed-out visitors (see
// App.tsx's logged-out route tree). Signed-in visitors never see this — "/"
// still resolves to CoachPage for them. Every capability, language, and
// classroom type named here is cross-checked against config.ts, the server
// prompts, and the relevant page components — no
// invented stats, pricing, testimonials, user counts, or unverified claims.
// The hero's product-preview panel mocks up the real Coach layout (sidebar +
// conversation + composer, see pages/CoachPage.tsx and components/Sidebar)
// and is genuinely interactive — you can click a Recent item to switch which
// illustrative exchange is shown, or type your own question and send it —
// rather than a static screenshot. Every scripted exchange is hand-written
// and factually correct (not a live API capture, since this is a static
// marketing page), and a typed message gets a canned "sign in to try it for
// real" reply instead of a fabricated AI answer.

const SITE_URL = 'https://www.sarastech.co.in/';
// Title kept under ~60 characters so Google shows it whole instead of rewriting
// it; the old one (90+ chars) was truncated in results. Leads with the brand
// (people search "SarasTech" / "Saras Tech") and the head term it can honestly
// compete on.
const HOME_TITLE = 'SarasTech — AI Teaching Assistant for Teachers in India';
const HOME_DESCRIPTION =
  'SarasTech is an AI teaching assistant for Indian teachers: get lesson plans, worksheets and quizzes with answer keys, in English or your regional language.';

const NAV_LINKS = [
  { href: '#why-sarastech', label: 'Why SarasTech' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#faq', label: 'FAQ' },
];

const FEATURES = [
  {
    icon: MessageCircleQuestion,
    title: 'AI Classroom Coach',
    description:
      'Ask any classroom question — a tricky concept, a behaviour issue, a classroom activity idea — and get grade- and subject-specific guidance instantly, powered by Google Gemini.',
  },
  {
    icon: Languages,
    title: 'Multilingual Answers',
    description:
      'Get coaching in English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia, or Hinglish — whichever your classroom speaks.',
  },
  {
    icon: ClipboardCheck,
    title: 'Quiz & Worksheet Generator',
    description:
      'Generate structured quizzes and worksheets by grade, subject, topic, and difficulty, complete with an answer key — ready to print.',
  },
  {
    icon: Library,
    title: 'Teaching Resource Library',
    description:
      'Save any AI answer, lesson plan, or worksheet to your personal library, edit it anytime, and export a classroom-ready PDF.',
  },
];

const STEPS = [
  {
    title: 'Ask or choose a task',
    description: 'On the Coach screen, type a classroom question or pick a ready-made task like a lesson plan, activity, or assessment.',
  },
  {
    title: 'Get an instant AI answer',
    description: 'Receive grade- and subject-specific guidance or a ready-to-use teaching resource, in your language.',
  },
  {
    title: 'Save, edit, and use it',
    description: 'Save it to your Library, refine it in the built-in Workspace editor, then print or export it as a PDF for your classroom.',
  },
];

const CLASSROOM_FACTS = [
  'Guidance for the realities of Indian schools — foundational literacy and numeracy (FLN), teaching aids made from everyday local materials, and printable resources you can edit to match your school’s format.',
  'Built for how classrooms actually run here — single-teacher, multi-grade, and mixed-ability setups, not just one-grade-one-teacher classrooms.',
  'Coaching and generated resources work in English plus 9 Indian languages and Hinglish, so language isn’t a barrier to getting help.',
];

type PreviewMessage = { role: 'user' | 'ai'; text: string };
type PreviewScenario = { id: string; title: string; messages: PreviewMessage[] };

// Three sample exchanges for the hero preview's clickable "Recent" list —
// illustrative, not live API captures (this is a static marketing page), but
// each answer is factually correct, matching the "no unverified claims" bar
// for this page.
const PREVIEW_SCENARIOS: PreviewScenario[] = [
  {
    id: 'photosynthesis',
    title: 'Explain photosynthesis to Grade 5',
    messages: [
      { role: 'user', text: 'How do I explain photosynthesis to my Grade 5 class?' },
      {
        role: 'ai',
        text: 'Think of a leaf as a tiny kitchen: sunlight is the stove, water from the roots and carbon dioxide from the air are the ingredients, and chlorophyll — what makes leaves green — does the cooking. The result is sugar for the plant to grow on, and oxygen released for us to breathe.',
      },
    ],
  },
  {
    id: 'fractions',
    title: 'Grade 4 fractions worksheet',
    messages: [
      { role: 'user', text: 'Can you put together a short worksheet on adding fractions for Grade 4?' },
      {
        role: 'ai',
        text: 'Here’s a 6-question starter, easiest to hardest: like denominators first (e.g. 1/4 + 2/4), then unlike (1/3 + 1/6), ending on one word problem about sharing a chocolate bar. A full worksheet with an answer key is ready to generate once you sign in.',
      },
    ],
  },
  {
    id: 'monsoon',
    title: 'Classroom activity for monsoon season',
    messages: [
      { role: 'user', text: 'Suggest a hands-on classroom activity about the monsoon.' },
      {
        role: 'ai',
        text: 'Try a simple rain-gauge activity: mark a clear jar in centimetres, place it outside, and have students log daily readings on a class chart — then discuss which day had the most rainfall and why.',
      },
    ],
  },
];

const FAQS = [
  {
    question: 'What is SarasTech?',
    answer:
      'SarasTech, also known as SarasTech AI (and sometimes written Saras Tech), is an AI teaching assistant for teachers in India. It combines an AI classroom coach with a worksheet, quiz, and question-paper generator, plus a personal library and editor for the resources you keep.',
  },
  {
    question: 'What can SarasTech do for me as a teacher?',
    answer:
      'Ask any classroom question and get instant, grade- and subject-specific coaching, generate lesson plans, worksheets, and quizzes with an answer key, and save everything to your own teaching library.',
  },
  {
    question: 'Which languages does it support?',
    answer:
      'English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia, and Hinglish — pick whichever your classroom speaks.',
  },
  {
    question: 'Does it work for multi-grade or mixed-ability classrooms?',
    answer:
      'Yes. You can set your classroom type — including multi-grade, mixed-ability, or large class — so coaching and generated resources match how you actually teach.',
  },
  {
    question: 'Can I edit what SarasTech generates?',
    answer:
      'Yes. Every saved lesson plan, worksheet, or quiz opens in a built-in editor, so you can refine it before printing or exporting it as a PDF.',
  },
  {
    question: 'Is there a SarasTech Android app?',
    answer: 'An Android app is coming soon. You can use SarasTech in your browser today.',
  },
  {
    question: 'Is my saved material private to me?',
    answer: 'Yes. Your resources and history are tied to your own account, so only you can see and edit them.',
  },
  {
    question: 'Is SarasTech aligned with NCERT, CBSE, or my state board?',
    answer:
      'SarasTech creates content from the grade, subject, and topic you give it. It is not tied to any board’s official syllabus or a specific textbook, so check what it generates against your own curriculum before using it.',
  },
  {
    question: 'Can the AI make mistakes?',
    answer:
      'Yes. AI-generated lesson ideas, questions, and answer keys can contain errors, so treat every result as a draft. Review it, edit it in the built-in editor, and check answer keys yourself before it reaches students.',
  },
];

// Organization / WebSite / WebPage / WebApplication / FAQPage graph (see
// seo/schema.ts). FAQPage's Question/Answer entries are derived from FAQS above —
// the same array the FAQ section renders — so the structured data can never
// drift from what's actually on the page. Google no longer shows FAQ rich
// results (retired May 2026); the markup is harmless, valid, and read by other
// consumers, so it stays.
const STRUCTURED_DATA = buildHomeGraph({ title: HOME_TITLE, description: HOME_DESCRIPTION, faqs: FAQS });

export default function HomePage() {
  const { theme, toggleTheme } = usePreferences();
  useDocumentMeta({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    canonical: SITE_URL,
  });
  useJsonLd(STRUCTURED_DATA);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  // Sign In / Get Started open the auth form in a pop-up over this page
  // instead of navigating to the full /login route — see components/AuthModal.
  // Opening pushes a history entry so the browser's Back button closes the
  // modal (and lands back on this page) instead of skipping past it and
  // leaving the site entirely — the modal otherwise never touches history.
  const [authMode, setAuthMode] = useState<Mode | null>(null);
  const openAuth = (mode: Mode) => {
    if (authMode === null) {
      window.history.pushState({ authModal: true }, '');
    }
    setAuthMode(mode);
  };
  const closeAuth = () => {
    setAuthMode(null);
    if (window.history.state?.authModal) {
      window.history.back();
    }
  };

  useEffect(() => {
    const handlePopState = () => setAuthMode(null);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Hero product-preview panel — genuinely interactive, matching how
  // claude.com/product/claude-code's own demo panel works: clicking a Recent
  // item swaps in that scripted exchange, "New chat" clears back to empty,
  // and typing a real question and sending it appends your message plus a
  // canned "sign in to try it for real" reply (their equivalent replies
  // "To try Claude, download it here." — never a fabricated AI answer).
  const [previewScenarioId, setPreviewScenarioId] = useState<string | null>(PREVIEW_SCENARIOS[0].id);
  const [previewDraft, setPreviewDraft] = useState('');
  const [previewSent, setPreviewSent] = useState<string[]>([]);
  const previewScenario = PREVIEW_SCENARIOS.find((s) => s.id === previewScenarioId) ?? null;

  // Collapse — real behaviour matching Sidebar.tsx's own collapse-to-rail:
  // hides everything but the rail toggle, same as .sidebar:not(.sidebar-open).
  // The search icon next to it is decorative only (not wired up).
  const [previewSidebarOpen, setPreviewSidebarOpen] = useState(true);

  function selectPreviewScenario(id: string) {
    setPreviewScenarioId(id);
    setPreviewSent([]);
    setPreviewDraft('');
  }
  function startPreviewChat() {
    setPreviewScenarioId(null);
    setPreviewSent([]);
    setPreviewDraft('');
  }
  function submitPreviewDraft(e: FormEvent) {
    e.preventDefault();
    const text = previewDraft.trim();
    if (!text) return;
    setPreviewSent((sent) => [...sent, text]);
    setPreviewDraft('');
  }

  // Header picks up a shadow once the page has scrolled past the hero, so the
  // sticky bar visually "lifts" off the content instead of just sitting flush
  // against a border the whole time. Passive listener, no rAF needed — this
  // only toggles a boolean, not a per-frame value.
  const [headerScrolled, setHeaderScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => setHeaderScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Subtle cursor-reactive parallax on the hero's background glow — skipped
  // entirely under prefers-reduced-motion (checked once, not re-evaluated
  // live, matching how the CSS-only ambient animations are gated elsewhere
  // on this page). Sets the transform directly on every event rather than
  // batching via requestAnimationFrame — the backdrop's own CSS `transition`
  // is what makes the motion glide, so a JS-side frame-throttle would add
  // complexity without changing what's on screen.
  const heroRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hero = heroRef.current;
    const backdrop = backdropRef.current;
    if (!hero || !backdrop) return;

    const handleMove = (event: MouseEvent) => {
      const rect = hero.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      backdrop.style.transform = `translate(${x * 50}px, ${y * 34}px)`;
    };
    const handleLeave = () => {
      backdrop.style.transform = 'translate(0, 0)';
    };
    hero.addEventListener('mousemove', handleMove);
    hero.addEventListener('mouseleave', handleLeave);
    return () => {
      hero.removeEventListener('mousemove', handleMove);
      hero.removeEventListener('mouseleave', handleLeave);
    };
  }, []);

  return (
    <div className="home-page">
      <AnnouncementBar />
      <div className={`home-header-bar${headerScrolled ? ' home-header-bar--scrolled' : ''}`}>
        <header className="home-header">
          <Link to="/" className="home-brand">
            <img src="/logo.png" alt="SarasTech" className="home-brand-logo" width={34} height={34} />
            <span className="home-brand-name">SarasTech</span>
          </Link>

          <nav className="home-nav" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="home-nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="home-header-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={theme === 'dark'}
            >
              <span className="home-theme-icon" aria-hidden="true">
                <Sun size={18} className={`home-theme-icon-sun${theme === 'dark' ? ' is-active' : ''}`} />
                <Moon size={18} className={`home-theme-icon-moon${theme === 'dark' ? '' : ' is-active'}`} />
              </span>
            </button>
            <button type="button" className="btn-text home-desktop-only" onClick={() => openAuth('login')}>
              Sign In
            </button>
            <button
              type="button"
              className="btn-primary home-header-cta home-desktop-only"
              onClick={() => openAuth('register')}
            >
              Get Started
            </button>
            <button
              type="button"
              className="icon-btn home-mobile-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="home-mobile-menu"
            >
              {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </header>

        {menuOpen && (
          <nav className="home-mobile-menu" id="home-mobile-menu" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="home-mobile-menu-link" onClick={closeMenu}>
                {link.label}
              </a>
            ))}
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                closeMenu();
                openAuth('login');
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                closeMenu();
                openAuth('register');
              }}
            >
              Get Started
            </button>
          </nav>
        )}
      </div>

      <main>
        <section className="home-hero" aria-labelledby="home-hero-heading" ref={heroRef}>
          <div className="home-hero-backdrop" aria-hidden="true" ref={backdropRef}>
            <span className="home-hero-glow-c" />
            <span className="home-hero-glow-a" />
            <span className="home-hero-glow-b" />
            <span className="home-hero-dots" />
          </div>

          <div className="home-hero-inner">
            <span className="home-kicker">
              <Sparkles size={13} aria-hidden="true" />
              AI Teacher Assistant
            </span>
            <h1 id="home-hero-heading">Your AI Teaching Assistant for Everyday Classrooms</h1>
            <p className="home-hero-subtitle">
              With SarasTech AI, ask a question and get a classroom-ready lesson plan, worksheet, or quiz — in English
              or your regional language.
            </p>
            <div className="home-hero-cta">
              <button type="button" className="btn-primary home-cta-primary" onClick={() => openAuth('register')}>
                Get Started
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              {/* Sign In already lives in the header, mobile menu, closing band and
                  footer, so the hero's second action shows what the product does
                  instead of repeating it. */}
              <a href="#how-it-works" className="btn-outline">
                See how it works
              </a>
            </div>
          </div>

          <div className="home-hero-visual-wrap">
            <div className="home-hero-visual" aria-label="A preview of the SarasTech Coach screen">
              <div className="home-hero-visual-chrome" aria-hidden="true">
                <span className="home-hero-visual-dot home-hero-visual-dot--red" />
                <span className="home-hero-visual-dot home-hero-visual-dot--yellow" />
                <span className="home-hero-visual-dot home-hero-visual-dot--green" />
                <span className="home-hero-visual-chrome-label">SarasTech Coach</span>
              </div>
              <div className="home-hero-visual-body">
                {/* Real nav, not decorative — mirrors Sidebar.tsx's new-chat
                    action and recent-threads list, and actually switches which
                    scripted exchange the panel shows on the right. */}
                <aside
                  className={`home-hero-visual-sidebar${previewSidebarOpen ? '' : ' home-hero-visual-sidebar--collapsed'}`}
                >
                  {previewSidebarOpen ? (
                    <>
                      {/* Mirrors Sidebar.tsx's own brand row: logo + "SarasTech"
                          / "Teacher Assistant" text on the left, search and
                          collapse actions on the right. The collapse button is
                          real (shrinks this to a rail, same as
                          .sidebar:not(.sidebar-open)); search is decorative
                          only, matching neither real search nor a fabricated
                          one. */}
                      <div className="home-hero-visual-brand">
                        <span className="home-hero-visual-brand-id">
                          <img src="/logo.png" alt="" className="home-hero-visual-brand-logo" />
                          <span className="home-hero-visual-brand-text">
                            <strong className="home-hero-visual-brand-title">SarasTech</strong>
                            <span className="home-hero-visual-brand-sub">Teacher Assistant</span>
                          </span>
                        </span>
                        <span className="home-hero-visual-brand-actions">
                          <span className="home-hero-visual-icon-btn" aria-hidden="true">
                            <Search size={12} strokeWidth={2.4} />
                          </span>
                          <button
                            type="button"
                            className="home-hero-visual-icon-btn"
                            onClick={() => setPreviewSidebarOpen(false)}
                            aria-label="Collapse sidebar"
                          >
                            <PanelLeft size={12} strokeWidth={2.4} />
                          </button>
                        </span>
                      </div>
                      <button type="button" className="home-hero-visual-newchat" onClick={startPreviewChat}>
                        <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
                        New chat
                      </button>
                      <span className="home-hero-visual-sidebar-label">Recent</span>
                      {PREVIEW_SCENARIOS.map((scenario) => (
                        <button
                          type="button"
                          key={scenario.id}
                          className="home-hero-visual-sidebar-item"
                          aria-current={previewScenarioId === scenario.id ? 'true' : undefined}
                          onClick={() => selectPreviewScenario(scenario.id)}
                        >
                          {scenario.title}
                        </button>
                      ))}
                      <span className="home-hero-visual-sidebar-user">
                        <span className="home-hero-visual-avatar">T</span>
                        Teacher
                      </span>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="home-hero-visual-icon-btn"
                      onClick={() => setPreviewSidebarOpen(true)}
                      aria-label="Expand sidebar"
                    >
                      <PanelLeft size={13} strokeWidth={2.4} />
                    </button>
                  )}
                </aside>
                <div className="home-hero-visual-chat">
                  <div className="home-hero-visual-messages">
                    {previewScenario ? (
                      previewScenario.messages.map((message, i) => (
                        <p className={`home-hero-visual-msg home-hero-visual-msg--${message.role}`} key={i}>
                          {message.text}
                        </p>
                      ))
                    ) : (
                      previewSent.length === 0 && (
                        <p className="home-hero-visual-empty">Type a question below to see SarasTech Coach in action.</p>
                      )
                    )}
                    {/* Mirrors claude.com/product/claude-code's own demo panel:
                        sending your own message there replies "To try Claude,
                        download it here." instead of a fabricated AI answer —
                        this is that same mechanism, with a real sign-in link,
                        and (like theirs) every message you send gets its own
                        reply, not just the first one. */}
                    {previewSent.flatMap((text, i) => [
                      <p className="home-hero-visual-msg home-hero-visual-msg--user" key={`sent-${i}`}>
                        {text}
                      </p>,
                      <p className="home-hero-visual-msg home-hero-visual-msg--ai" key={`reply-${i}`}>
                        To try SarasTech,{' '}
                        <button type="button" className="auth-link" onClick={() => openAuth('login')}>
                          sign in here
                        </button>
                        .
                      </p>,
                    ])}
                  </div>
                  {/* Mirrors Composer.tsx's real two-row shape and exact copy
                      ("Ask anything about teaching…", "Assistant Mode") — and,
                      unlike the old static version, this input actually works. */}
                  <form className="home-hero-visual-composer" onSubmit={submitPreviewDraft}>
                    <input
                      className="home-hero-visual-composer-text"
                      type="text"
                      value={previewDraft}
                      onChange={(e) => setPreviewDraft(e.target.value)}
                      placeholder="Ask anything about teaching…"
                      aria-label="Try SarasTech Coach — ask a classroom question"
                    />
                    <div className="home-hero-visual-composer-row">
                      <span className="home-hero-visual-composer-controls">
                        <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
                        <span className="home-hero-visual-mode-pill">Assistant Mode</span>
                      </span>
                      <span className="home-hero-visual-composer-controls">
                        <Mic size={14} strokeWidth={2.4} aria-hidden="true" />
                        <button type="submit" className="home-hero-visual-send" aria-label="Send">
                          <ArrowUp size={14} strokeWidth={2.8} />
                        </button>
                      </span>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <ul className="home-hero-points" aria-label="Highlights">
            <li className="home-hero-points-primary">
              <Languages size={15} aria-hidden="true" />
              9 Indian languages + Hinglish
            </li>
            <li className="home-hero-points-primary">
              <GraduationCap size={15} aria-hidden="true" />
              Built for real classrooms
            </li>
          </ul>
        </section>

        <section className="home-section" id="why-sarastech" aria-labelledby="home-problem-heading">
          <div className="home-why-grid">
            <div className="home-why-copy home-reveal">
              <span className="home-eyebrow">Why SarasTech</span>
              <h2 className="home-why-label" id="home-problem-heading">
                Building a lesson plan, worksheet, or quiz from scratch — or finding guidance in your own language —
                takes time most teachers don&rsquo;t have between classes.
              </h2>
            </div>
            <div className="home-why-panel home-reveal">
              <span className="home-why-icon" aria-hidden="true">
                <Sparkles size={22} strokeWidth={1.8} />
              </span>
              <h3>One AI assistant, ready when you are</h3>
              <p>
                SarasTech combines an AI classroom coach with a lesson plan, worksheet, and quiz generator — in
                English or your regional language — so you get a usable answer or resource in minutes.
              </p>
            </div>
          </div>
        </section>

        <section className="home-section" id="features" aria-labelledby="home-features-heading">
          <span className="home-eyebrow">Features</span>
          <h2 id="home-features-heading">AI Tools for Teachers, Built Into One Assistant</h2>
          <div className="home-feature-grid">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              const isFeatured = index === 0;
              return (
                <article
                  className={`home-feature-card home-reveal${isFeatured ? ' home-feature-card--featured' : ''}`}
                  key={feature.title}
                >
                  <div className="home-feature-copy">
                    <span className="home-feature-icon" aria-hidden="true">
                      <Icon size={22} strokeWidth={1.8} />
                    </span>
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                  </div>
                  {/* A real Coach answer (public/product/coach-en-*.png) fills what
                      used to be the featured card's empty right half. */}
                  {isFeatured && (
                    <ProductShot
                      name="coach-en"
                      alt="SarasTech Coach suggesting a hands-on fractions activity for Grade 4, tagged Class 3-5 and Mathematics"
                      width={480}
                      height={540}
                      caption="A real answer from SarasTech Coach"
                      fade
                      maxHeight={360}
                    />
                  )}
                </article>
              );
            })}
          </div>
          <p className="home-feature-note">
            Also included: classroom and attendance management tools, so your class lists, students, and daily
            attendance live alongside your teaching materials.
          </p>
        </section>

        {/* Crawlable, descriptive internal links to every public tool and guide
            page (seo/pages.ts) — the home page is the strongest page on the
            site, so this is where their internal linking starts. */}
        <section className="home-section" id="explore" aria-labelledby="home-explore-heading">
          <div className="home-head">
            <span className="home-eyebrow">Explore</span>
            <h2 id="home-explore-heading">Lesson Plans, Worksheets, Quizzes and More</h2>
          </div>
          <div className="seo-related-grid seo-related-grid--wide">
            {TOOL_PAGES.map((page) => (
              <Link key={page.path} to={page.path} className="seo-related-card">
                <span className="seo-related-kind">Tool</span>
                <strong>{page.navLabel}</strong>
                <span>{page.teaser}</span>
              </Link>
            ))}
          </div>
          <h3 className="seo-guides-heading">Guides for teachers</h3>
          <ul className="seo-guide-links">
            {GUIDE_PAGES.map((page) => (
              <li key={page.path}>
                <Link to={page.path}>{page.navLabel}</Link>
                <span>{page.teaser}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-section home-section--muted" id="how-it-works" aria-labelledby="home-steps-heading">
          <div className="home-how">
            <div className="home-how-main">
              <div className="home-head">
                <span className="home-eyebrow">How It Works</span>
                <h2 id="home-steps-heading">From Question to Classroom-Ready Resource</h2>
              </div>
              <ol className="home-steps home-steps--stacked">
                {STEPS.map((step, index) => (
                  <li className="home-step home-reveal" key={step.title}>
                    <span className="home-step-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </li>
                ))}
              </ol>
            </div>
            {/* A real generated worksheet (Generator → Preview). */}
            <ProductShot
              name="generator-worksheet"
              alt="A Class 3-5 Science worksheet on parts of a plant, generated by SarasTech, with a multiple-choice question and its correct answer marked"
              width={464}
              height={678}
              caption="A worksheet generated in SarasTech"
            />
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-audience-heading">
          <div className="home-audience home-reveal">
            {/* A real Hindi answer — the language claim, shown instead of told. */}
            <ProductShot
              name="coach-hi"
              alt="SarasTech Coach explaining the water cycle for Class 5 in Hindi, in Devanagari script"
              width={480}
              height={540}
              caption="A real SarasTech Coach answer in Hindi (हिंदी)"
              fade
              maxHeight={440}
            />
            <div className="home-audience-copy">
              <div className="home-head">
                <span className="home-eyebrow">Made for India</span>
                <h2 id="home-audience-heading">Built for Real Indian Classrooms</h2>
              </div>
              <p className="home-audience-lead">
                Practical AI support for everyday teaching — from lesson planning and classroom activities to
                assessments and teaching resources, with support for multiple Indian languages.
              </p>
              <ul className="home-audience-list">
                {CLASSROOM_FACTS.map((fact) => (
                  <li key={fact}>
                    <span className="home-audience-check" aria-hidden="true">
                      <Check size={14} strokeWidth={2.4} />
                    </span>
                    <p>{fact}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="home-section" id="android" aria-labelledby="home-android-heading">
          <div className="home-android-card home-reveal">
            <span className="home-android-icon" aria-hidden="true">
              <Smartphone size={26} strokeWidth={1.8} />
            </span>
            <div className="home-android-copy">
              <span className="home-android-eyebrow">Coming soon</span>
              <h2 id="home-android-heading">SarasTech for Android is on the way</h2>
              <p>
                We&rsquo;re building the SarasTech Android app so you can use your AI teaching assistant on your
                phone. Web is available today.
              </p>
            </div>
            <a className="btn-outline home-android-cta" href="#follow">
              Follow for updates
            </a>
          </div>
        </section>

        <section className="home-section" id="faq" aria-labelledby="home-faq-heading">
          <div className="home-faq-layout">
            <div className="home-head">
              <div className="home-faq-icon-wrap">
                <div className="home-faq-icon" aria-hidden="true">
                  <span className="home-faq-icon-ring" />
                  <CircleHelp size={28} strokeWidth={1.8} />
                </div>
              </div>
              <span className="home-eyebrow">FAQ</span>
              <h2 id="home-faq-heading">Frequently Asked Questions</h2>
            </div>
            <div className="home-faq-list home-reveal">
              {/* name= makes these a native, browser-managed exclusive accordion
                  (HTML Living Standard) — opening one collapses whichever other
                  one was open, with no React state and no risk of the toggle
                  event's own feedback loop (setting `open` programmatically
                  fires another native "toggle" event, which made a React-state
                  version of this close everything). */}
              {FAQS.map((faq) => (
                <details className="home-faq-item" key={faq.question} name="home-faq">
                  <summary className="home-faq-question">
                    <span>{faq.question}</span>
                    <ChevronDown className="home-faq-chevron" size={18} aria-hidden="true" />
                  </summary>
                  <p className="home-faq-answer">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="home-cta-band" aria-labelledby="home-final-cta-heading">
          <div className="home-cta-band-inner home-reveal">
            <h2 id="home-final-cta-heading">Ready to Teach Smarter?</h2>
            <p>
              Create your teacher account and turn a classroom question into a lesson plan, worksheet, quiz, or ready
              answer — in your language.
            </p>
            <div className="home-hero-cta">
              <button type="button" className="btn-primary home-cta-primary" onClick={() => openAuth('register')}>
                Get Started
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-outline home-cta-outline-inverse"
                onClick={() => openAuth('login')}
              >
                Sign In
              </button>
            </div>
          </div>
        </section>

        <SocialLinks />
      </main>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <div className="home-footer-col">
            <div className="home-footer-brand-row">
              <img src="/logo.png" alt="" className="home-footer-logo" width={24} height={24} />
              <span>SarasTech</span>
            </div>
            <p className="home-footer-tagline">An AI teaching assistant built for everyday classroom work in India.</p>
          </div>
          <div className="home-footer-col">
            <h4>Product</h4>
            <ul>
              <li>
                <a href="#why-sarastech">Why SarasTech</a>
              </li>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#how-it-works">How It Works</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
              </li>
            </ul>
          </div>
          <FooterSeoColumns />
          <div className="home-footer-col">
            <h4>Account &amp; Legal</h4>
            <ul>
              <li>
                <button type="button" className="home-footer-link-btn" onClick={() => openAuth('login')}>
                  Sign In
                </button>
              </li>
              <li>
                <Link to={ABOUT_PAGE.path}>About SarasTech</Link>
              </li>
              <li>
                <Link to="/terms">Terms of Service</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy Policy</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="home-footer-bottom">© {new Date().getFullYear()} SarasTech</div>
      </footer>

      <AuthModal open={authMode !== null} mode={authMode ?? 'login'} theme={theme} onClose={closeAuth} />
    </div>
  );
}
