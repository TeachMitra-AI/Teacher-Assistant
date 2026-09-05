import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Sun,
  Moon,
  Menu,
  X,
  Clock,
  Sparkles,
  ChevronDown,
  CircleHelp,
  Zap,
  Wand2,
  Workflow,
  MapPin,
  GraduationCap,
  MessageCircleQuestion,
  Languages,
  ClipboardCheck,
  Library,
  Check,
} from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import { QUICK_ACTIONS } from '../config';
import { getWelcomeGreeting } from '../lib/welcome';

// Public marketing landing page shown at "/" to signed-out visitors (see
// App.tsx's logged-out route tree). Signed-in visitors never see this — "/"
// still resolves to CoachPage for them. Every capability, language, classroom
// type, and lesson-plan-structure claim named here is cross-checked against
// config.ts, lessonPlanSchema.js, and the relevant page components — no
// invented stats, pricing, testimonials, user counts, or unverified claims.
// The hero's product preview renders the real QUICK_ACTIONS config and the
// real lib/welcome.ts greeting logic — the same data and function the
// signed-in Coach welcome screen uses — rather than a fabricated screenshot.

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
  'Lesson plans follow the standard NCERT / B.Ed.-style structure used in Indian schools — objectives, teaching-learning material, a blackboard summary, and recap questions included.',
  'Built for how classrooms actually run here — single-teacher, multi-grade, and mixed-ability setups, not just one-grade-one-teacher classrooms.',
  'Coaching and generated resources work in English plus 9 Indian languages and Hinglish, so language isn’t a barrier to getting help.',
];

// Real, deterministic greeting logic from lib/welcome.ts — the same function
// the signed-in Coach welcome screen calls. Shown here with a generic
// placeholder name (no user is signed in yet) so the hero preview reflects
// actual product behaviour rather than a static, fabricated screenshot.
const PREVIEW_GREETING = getWelcomeGreeting('Teacher');

const FAQS = [
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
    question: 'Is my saved material private to me?',
    answer: 'Yes. Your resources and history are tied to your own account, so only you can see and edit them.',
  },
];

export default function HomePage() {
  const { theme, toggleTheme } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

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
      <div className={`home-header-bar${headerScrolled ? ' home-header-bar--scrolled' : ''}`}>
        <header className="home-header">
          <Link to="/" className="home-brand">
            <img src="/logo.png" alt="SarasTech" className="home-brand-logo" />
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
            <Link to="/login" className="btn-text home-desktop-only">
              Sign In
            </Link>
            <Link to="/login?mode=register" className="btn-primary home-header-cta home-desktop-only">
              Get Started
            </Link>
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
            <Link to="/login" className="btn-outline" onClick={closeMenu}>
              Sign In
            </Link>
            <Link to="/login?mode=register" className="btn-primary" onClick={closeMenu}>
              Get Started
            </Link>
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
              Ask a question, get a classroom-ready lesson plan, worksheet, or quiz — in English or your regional
              language.
            </p>
            <div className="home-hero-cta">
              <Link to="/login?mode=register" className="btn-primary home-cta-primary">
                Get Started
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/login" className="btn-outline">
                Sign In
              </Link>
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
              <p className="home-hero-visual-greeting">{PREVIEW_GREETING.greeting}</p>
              <p className="home-hero-visual-label">Things teachers ask every day</p>
              <div className="home-hero-visual-grid">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <div className="home-example-card" key={action.label}>
                      <span className="home-example-icon" aria-hidden="true">
                        <Icon size={18} strokeWidth={2} />
                      </span>
                      <span className="home-example-title">{action.label}</span>
                      <span className="home-example-desc">{action.description}</span>
                    </div>
                  );
                })}
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
              <Clock className="home-why-watermark" aria-hidden="true" size={180} strokeWidth={1} />
              <div className="home-section-icon home-section-icon--left" aria-hidden="true">
                <Zap size={24} strokeWidth={1.8} />
              </div>
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
          <div className="home-section-icon" aria-hidden="true">
            <Wand2 size={24} strokeWidth={1.8} />
          </div>
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
                  <span className="home-feature-icon" aria-hidden="true">
                    <Icon size={22} strokeWidth={1.8} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              );
            })}
          </div>
          <p className="home-feature-note">
            Also included: classroom and attendance management tools, so your class lists, students, and daily
            attendance live alongside your teaching materials.
          </p>
        </section>

        <section className="home-section home-section--muted" id="how-it-works" aria-labelledby="home-steps-heading">
          <div className="home-section-icon" aria-hidden="true">
            <Workflow size={24} strokeWidth={1.8} />
          </div>
          <span className="home-eyebrow">How It Works</span>
          <h2 id="home-steps-heading">From Question to Classroom-Ready Resource</h2>
          <ol className="home-steps">
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
        </section>

        <section className="home-section" aria-labelledby="home-audience-heading">
          <div className="home-section-icon" aria-hidden="true">
            <MapPin size={24} strokeWidth={1.8} />
          </div>
          <span className="home-eyebrow">Made for India</span>
          <h2 id="home-audience-heading">Built for Real Indian Classrooms</h2>
          <div className="home-audience-panel home-reveal">
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
        </section>

        <section className="home-section" id="faq" aria-labelledby="home-faq-heading">
          <div className="home-faq-icon-wrap">
            <div className="home-faq-icon" aria-hidden="true">
              <span className="home-faq-icon-ring" />
              <CircleHelp size={28} strokeWidth={1.8} />
            </div>
          </div>
          <span className="home-eyebrow">FAQ</span>
          <h2 id="home-faq-heading">Frequently Asked Questions</h2>
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
        </section>

        <section className="home-cta-band" aria-labelledby="home-final-cta-heading">
          <div className="home-cta-band-inner home-reveal">
            <h2 id="home-final-cta-heading">Ready to Teach Smarter?</h2>
            <p>
              Create your teacher account and turn a classroom question into a lesson plan, worksheet, quiz, or ready
              answer — in your language.
            </p>
            <div className="home-hero-cta">
              <Link to="/login?mode=register" className="btn-primary home-cta-primary">
                Get Started
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/login" className="btn-outline home-cta-outline-inverse">
                Sign In
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <div className="home-footer-col">
            <div className="home-footer-brand-row">
              <img src="/logo.png" alt="" className="home-footer-logo" />
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
          <div className="home-footer-col">
            <h4>Account &amp; Legal</h4>
            <ul>
              <li>
                <Link to="/login">Sign In</Link>
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
    </div>
  );
}
