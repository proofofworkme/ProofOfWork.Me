import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import { youtubeLinksFromText, type YouTubeLink } from "./youtubeLinks.mjs";
import "./youtube.css";

function YouTubeCard({ link }: { link: YouTubeLink }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [playerFits, setPlayerFits] = useState(false);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setPlayerFits(frame.clientWidth >= 200);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const embedUrl = `https://www.youtube-nocookie.com/embed/${link.videoId}?autoplay=1&playsinline=1${link.start ? `&start=${link.start}` : ""}`;
  return <div className="youtube-link-card" data-testid="youtube-link-card"
    onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    }}>
    <div className="youtube-player-frame" ref={frameRef}>
      {loaded && playerFits ? <iframe title="YouTube video player" src={embedUrl}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> :
        <button className="youtube-play-button" type="button" aria-label={playerFits ? "Play YouTube video" : "Video preview — open on YouTube below"} disabled={!playerFits}
          onClick={() => setLoaded(true)}>
          {!posterFailed ? <img src={`https://i.ytimg.com/vi/${link.videoId}/hqdefault.jpg`} alt=""
            loading="lazy" decoding="async" onError={() => setPosterFailed(true)} /> : null}
          {playerFits ? <span className="youtube-play-icon"><Play size={28} fill="currentColor" aria-hidden="true" /></span> : null}
          <span className="youtube-play-label">{playerFits ? "Play video" : "Open on YouTube below"}</span>
        </button>}
    </div>
    <div className="youtube-card-footer"><span>YouTube</span>
      <a href={link.watchUrl} target="_blank" rel="noopener noreferrer">Open on YouTube <ArrowUpRight size={14} aria-hidden="true" /></a>
    </div>
  </div>;
}

export function YouTubeLinkCards({ text }: { text: string }) {
  const links = useMemo(() => youtubeLinksFromText(text), [text]);
  if (!links.length) return null;
  return <div className="youtube-link-cards">{links.map(link =>
    <YouTubeCard key={`${link.videoId}:${link.start}`} link={link} />)}</div>;
}
