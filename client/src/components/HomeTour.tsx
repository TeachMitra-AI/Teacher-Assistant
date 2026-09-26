import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Pause, Play } from 'lucide-react';

// "See it in action" — a ~28s muted loop recorded in the running product
// (Library → Lesson Plan → Worksheet → Classroom attendance), never a mock-up.
//
// Two recordings, because one cannot serve both: the desktop cut is a 1280×720
// capture of the desktop layout, which shrinks to ~0.27× in a phone-width frame
// and turns body text into ~4px smudges. The mobile cut is the real app at a
// 390px phone viewport (2×, 780×1172), shown at ~0.9× so text stays readable.
// Each ships in light and dark (client/public/product/sarastech-tour[-mobile]-
// <theme>.mp4 + .webp poster), chosen by viewport width and site theme; only the
// active one is ever requested.
//
// Loading: `preload="none"` until the section is within ~600px of the
// viewport, so the file never competes with the hero. Playback: it plays while
// at least half the frame is on screen and pauses when it leaves; a visitor who
// pauses it stays paused. It never autoplays under prefers-reduced-motion or
// data-saver (poster + play button instead). The poster is the video's opening
// frame and is the fallback if the video can't load.

type Theme = 'light' | 'dark';
type Variant = 'desktop' | 'mobile';

const MOBILE_QUERY = '(max-width: 767px)';

// Start times (seconds) of each scene in each cut, measured from the edited
// videos. The final seconds return to the Library view so the loop closes
// seamlessly; they belong to chapter 0.
const CHAPTERS: Record<Variant, { labels: readonly { label: string; start: number }[]; loopTailStart: number }> = {
  desktop: {
    labels: [
      { label: 'Library', start: 0 },
      { label: 'Lesson plan', start: 1.4 },
      { label: 'Worksheet', start: 7.9 },
      { label: 'Classroom', start: 15.5 },
    ],
    loopTailStart: 25.6,
  },
  mobile: {
    labels: [
      { label: 'Library', start: 0 },
      { label: 'Lesson plan', start: 3.85 },
      { label: 'Worksheet', start: 9.2 },
      { label: 'Classroom', start: 13.3 },
    ],
    loopTailStart: 26.1,
  },
};

function chapterIndexAt(time: number, variant: Variant): number {
  const { labels, loopTailStart } = CHAPTERS[variant];
  if (time >= loopTailStart) return 0;
  let index = 0;
  labels.forEach((chapter, i) => {
    if (time >= chapter.start) index = i;
  });
  return index;
}

// Read synchronously so the very first render already asks for the right poster
// (a phone must never download the desktop poster first).
function readVariant(): Variant {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  return window.matchMedia(MOBILE_QUERY).matches ? 'mobile' : 'desktop';
}

interface HomeTourProps {
  theme: Theme;
  onGetStarted: () => void;
}

export function HomeTour({ theme, onGetStarted }: HomeTourProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const userPaused = useRef(false);
  const lastSource = useRef('');
  // Last real playhead/play state. Swapping `src` makes the browser reset
  // currentTime to 0 and pause during the commit, so the values to carry over
  // have to be remembered from before it, not read afterwards.
  const playhead = useRef({ fraction: 0, playing: false });

  const [variant, setVariant] = useState<Variant>(readVariant);
  const [autoplayOk, setAutoplayOk] = useState(false);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState(0);

  const source = `${variant === 'mobile' ? 'mobile-' : ''}${theme}`;
  const chapters = CHAPTERS[variant].labels;

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true; // React doesn't reflect the `muted` prop onto the element reliably
    video.play().catch(() => setPlaying(false));
  }, []);

  // Follow the viewport (rotation, resizing) so the right cut is always shown.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setVariant(query.matches ? 'mobile' : 'desktop');
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  // Autoplay only where it is welcome.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    setAutoplayOk(!reducedMotion && !saveData);
  }, []);

  // Start fetching shortly before the section scrolls into view.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Play while mostly visible, pause when it leaves.
  useEffect(() => {
    const stage = stageRef.current;
    if (!autoplayOk || !stage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const video = videoRef.current;
        if (!video) return;
        if (entry.isIntersecting) {
          if (!userPaused.current) play();
        } else {
          video.pause();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [autoplayOk, play]);

  // A theme or viewport change swaps the file; carry the position (as a share of
  // the runtime — the cuts differ in length) and play state across. A layout
  // effect so the listener is attached before any media event can fire.
  useLayoutEffect(() => {
    if (lastSource.current === source) return;
    const first = lastSource.current === '';
    lastSource.current = source;
    if (first) return;
    const video = videoRef.current;
    if (!video) return;
    const { fraction, playing: wasPlaying } = playhead.current;
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = fraction * video.duration;
        if (wasPlaying) play();
      },
      { once: true },
    );
  }, [source, play]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return; // no duration = mid-reload, not a real position
    playhead.current.fraction = video.currentTime / video.duration;
    setProgress(video.currentTime / video.duration);
    setChapter(chapterIndexAt(video.currentTime, variant));
  };

  const handleStart = () => {
    userPaused.current = false;
    setArmed(true);
    play();
  };

  const handleToggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      play();
    } else {
      userPaused.current = true;
      video.pause();
    }
  };

  const handleChapter = (start: number) => {
    const video = videoRef.current;
    if (!video) return;
    userPaused.current = false;
    setArmed(true);
    video.currentTime = start;
    setChapter(chapterIndexAt(start, variant));
    play();
  };

  return (
    <section className="home-section home-tour" id="see-it-in-action" aria-labelledby="home-tour-heading">
      <div className="home-tour-head home-reveal">
        <span className="home-eyebrow">See it in action</span>
        <h2 id="home-tour-heading">Your lesson prep and your classroom, in one workspace</h2>
        <p>
          A 30-second tour of the real product: lesson plans and worksheets saved in your Library, then your class
          lists and daily attendance.
        </p>
      </div>

      <figure className="home-tour-figure home-reveal">
        <div className={`home-tour-stage${variant === 'mobile' ? ' home-tour-stage--mobile' : ''}`} ref={stageRef}>
          <div className="home-tour-window">
            <div className="home-tour-chrome" aria-hidden="true">
              <span className="home-hero-visual-dot home-hero-visual-dot--red" />
              <span className="home-hero-visual-dot home-hero-visual-dot--yellow" />
              <span className="home-hero-visual-dot home-hero-visual-dot--green" />
              <span className="home-hero-visual-chrome-label">SarasTech Workspace</span>
            </div>
            <div className="home-tour-screen">
              <video
                ref={videoRef}
                className="home-tour-video"
                src={`/product/sarastech-tour-${source}.mp4`}
                poster={`/product/sarastech-tour-${source}.webp`}
                width={variant === 'mobile' ? 390 : 1280}
                height={variant === 'mobile' ? 586 : 720}
                muted
                loop
                playsInline
                disablePictureInPicture
                preload={armed ? 'auto' : 'none'}
                aria-label="Product tour: a teacher opens a saved lesson plan and worksheet, then marks class attendance."
                aria-describedby="home-tour-desc"
                onPlay={() => {
                  playhead.current.playing = true;
                  setPlaying(true);
                }}
                onPause={(event) => {
                  // readyState 0 = the browser paused it for a src reload, not the visitor.
                  if (event.currentTarget.readyState > 0) playhead.current.playing = false;
                  setPlaying(false);
                }}
                onTimeUpdate={handleTimeUpdate}
                onError={() => setFailed(true)}
              />
              {!failed && !playing && (
                <button type="button" className="home-tour-play" onClick={handleStart} aria-label="Play the 30-second product tour">
                  <Play size={26} aria-hidden="true" />
                </button>
              )}
              {!failed && playing && (
                <button type="button" className="home-tour-toggle" onClick={handleToggle} aria-label="Pause the product tour">
                  <Pause size={16} aria-hidden="true" />
                </button>
              )}
              <div className="home-tour-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${progress})` }} />
              </div>
            </div>
          </div>
        </div>

        {!failed && (
          <ul className="home-tour-chapters" aria-label="Jump to a part of the tour">
            {chapters.map((item, index) => (
              <li key={item.label}>
                <button
                  type="button"
                  className={`home-tour-chip${chapter === index ? ' is-active' : ''}`}
                  aria-current={chapter === index ? 'true' : undefined}
                  onClick={() => handleChapter(item.start)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <figcaption className="visually-hidden" id="home-tour-desc">
          A silent screen recording of the SarasTech app. It opens the Library of saved resources, shows a lesson plan
          on photosynthesis, then a worksheet with its teacher answer key, then a Class 5-A roster and the daily
          attendance being marked for each student.
        </figcaption>
      </figure>

      <div className="home-tour-cta">
        <button type="button" className="btn-primary home-cta-primary" onClick={onGetStarted}>
          Get Started
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <a href="#how-it-works" className="btn-outline">
          See how it works
        </a>
      </div>
    </section>
  );
}
