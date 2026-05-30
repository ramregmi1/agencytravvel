// Himalayan Modernism style rules for this file:
// - Full-bleed Nepal imagery with bold diagonal cuts
// - Glass UI on top of landscape
// - Saffron accents for CTAs, minimal iconography

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { LatLngBounds } from "leaflet";

import heroImg from "@/assets/nepal-hero.jpg";
import lakeImg from "@/assets/nepal-lake.jpg";
import everestImg from "@/assets/everest.jpg";
import everestRangeImg from "@/assets/everest-range.jpg";
import lumbiniImg from "@/assets/lumbini.jpg";
import chitwanImg from "@/assets/chitwan.jpg";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import TopBar from "@/components/TopBar";

import {
  ArrowRight,
  Bus,
  Clock,
  Compass,
  Hotel,
  Landmark,
  Loader2,
  MapPinned,
  Navigation,
  Route,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";

type Place = {
  label: string;
  lat: number;
  lon: number;
};

type RouteResult = {
  distanceKm: number;
  durationMin: number;
  geometry: [number, number][]; // [lat, lon]
};

type HotelHit = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stars?: string;
  phone?: string;
  website?: string;
  source: "Overpass";
};

function formatMins(mins: number) {
  if (!isFinite(mins)) return "–";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m} min`;
  return `${h} h ${m} min`;
}

function FitBounds({ bounds }: { bounds: LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [28, 28] });
  }, [bounds, map]);
  return null;
}

async function photonGeocode(q: string): Promise<Place[]> {
  const url = "https://photon.komoot.io/api/";
  const { data } = await axios.get(url, {
    params: { q, limit: 6, lang: "en" },
  });

  const features = (data?.features ?? []) as any[];
  return features
    .map((f) => {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      const p = f.properties ?? {};
      const label = [p.name, p.city, p.state, p.country]
        .filter(Boolean)
        .join(", ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        label: label || q,
        lat: Number(lat),
        lon: Number(lon),
      } as Place;
    })
    .filter((x) => isFinite(x.lat) && isFinite(x.lon));
}

async function osrmRoute(origin: Place, dest: Place): Promise<RouteResult> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}`;
  const { data } = await axios.get(url, {
    params: { overview: "full", geometries: "geojson", alternatives: false },
  });

  const r = data?.routes?.[0];
  if (!r) throw new Error("No route found");

  const coords = (r.geometry?.coordinates ?? []) as [number, number][]; // [lon,lat]
  const geometry: [number, number][] = coords.map(([lon, lat]) => [lat, lon]);
  return {
    distanceKm: (Number(r.distance) || 0) / 1000,
    durationMin: (Number(r.duration) || 0) / 60,
    geometry,
  };
}

function midpoint(a: Place, b: Place): Place {
  return {
    label: "Midpoint",
    lat: (a.lat + b.lat) / 2,
    lon: (a.lon + b.lon) / 2,
  };
}

async function overpassHotels(center: Place, radiusM: number): Promise<HotelHit[]> {
  // Overpass QL: hotels around a point (amenity=hotel OR tourism=hotel)
  const query = `
[out:json][timeout:25];
(
  nwr["tourism"="hotel"](around:${radiusM},${center.lat},${center.lon});
  nwr["amenity"="hotel"](around:${radiusM},${center.lat},${center.lon});
);
out center 24;
`;

  const url = "https://overpass-api.de/api/interpreter";
  const { data } = await axios.post(url, query, {
    headers: { "Content-Type": "text/plain" },
  });

  const el = (data?.elements ?? []) as any[];
  const hits: HotelHit[] = el
    .map((x) => {
      const lat = x.lat ?? x.center?.lat;
      const lon = x.lon ?? x.center?.lon;
      const tags = x.tags ?? {};
      const name = tags.name || tags["name:en"] || "Hotel";
      return {
        id: String(x.id),
        name,
        lat: Number(lat),
        lon: Number(lon),
        stars: tags.stars ? String(tags.stars) : undefined,
        phone: tags.phone || tags["contact:phone"],
        website: tags.website || tags["contact:website"],
        source: "Overpass" as const,
      };
    })
    .filter((x) => isFinite(x.lat) && isFinite(x.lon));

  // Deduplicate by name+rounded coords
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.name}|${h.lat.toFixed(4)}|${h.lon.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateCost(distanceKm: number, mode: "private" | "tourist-bus") {
  // Rough, tweakable estimates in NPR
  if (!isFinite(distanceKm)) return 0;
  const base = mode === "private" ? 75 : 32; // NPR per km
  const min = mode === "private" ? 1200 : 350;
  return Math.round(Math.max(min, distanceKm * base));
}

export default function Home({ targetSection }: { targetSection?: string }) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [heroShift, setHeroShift] = useState(0);
  const [originText, setOriginText] = useState("Kathmandu");
  const [destText, setDestText] = useState("Pokhara");

  const [originSug, setOriginSug] = useState<Place[]>([]);
  const [destSug, setDestSug] = useState<Place[]>([]);
  const [focusField, setFocusField] = useState<"origin" | "dest" | null>(null);

  const [recentTrips, setRecentTrips] = useState<{ o: string; d: string; t: number }[]>([]);

  const [mode, setMode] = useState<"private" | "tourist-bus">("tourist-bus");

  const [isLoading, setIsLoading] = useState(false);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);

  const [hotels, setHotels] = useState<HotelHit[]>([]);
  const [hotelLoading, setHotelLoading] = useState(false);

  // Parallax hero (subtle, premium)
  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        const shift = Math.max(-22, Math.min(28, y * 0.06));
        setHeroShift(shift);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Load shared params + recent trips
  useEffect(() => {
    // parse hash like #/planner?o=Kathmandu&d=Pokhara
    const h = window.location.hash || "";
    const qIndex = h.indexOf("?");
    if (qIndex >= 0) {
      const qs = h.slice(qIndex + 1);
      const p = new URLSearchParams(qs);
      const o = p.get("o");
      const d = p.get("d");
      if (o) setOriginText(decodeURIComponent(o));
      if (d) setDestText(decodeURIComponent(d));
    }

    try {
      const raw = localStorage.getItem("nr_recent") || "[]";
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setRecentTrips(arr.slice(0, 6));
    } catch {
      // ignore
    }
  }, []);

  // Autocomplete (Photon) – debounced
  useEffect(() => {
    if (focusField !== "origin") return;
    const q = originText.trim();
    if (q.length < 3) return setOriginSug([]);
    const t = window.setTimeout(async () => {
      try {
        const hits = await photonGeocode(q);
        setOriginSug(hits.slice(0, 6));
      } catch {
        setOriginSug([]);
      }
    }, 260);
    return () => window.clearTimeout(t);
  }, [originText, focusField]);

  useEffect(() => {
    if (focusField !== "dest") return;
    const q = destText.trim();
    if (q.length < 3) return setDestSug([]);
    const t = window.setTimeout(async () => {
      try {
        const hits = await photonGeocode(q);
        setDestSug(hits.slice(0, 6));
      } catch {
        setDestSug([]);
      }
    }, 260);
    return () => window.clearTimeout(t);
  }, [destText, focusField]);

  // Scroll to section (supports /#/planner etc.)
  useEffect(() => {
    if (!targetSection) return;
    document.getElementById(targetSection)?.scrollIntoView({ behavior: "smooth" });
  }, [targetSection]);

  const mapBounds = useMemo(() => {
    if (!route?.geometry?.length) return null;
    const b = new LatLngBounds([]);
    for (const [lat, lon] of route.geometry) b.extend([lat, lon]);
    return b;
  }, [route]);

  const costNpr = useMemo(() => {
    return estimateCost(route?.distanceKm ?? 0, mode);
  }, [route?.distanceKm, mode]);

  function parseCoords(input: string): Place | null {
    const m = input
      .trim()
      .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return { label: input.trim(), lat, lon };
  }

  async function planTrip() {
    const o = originText.trim();
    const d = destText.trim();
    if (!o || !d) return toast.error("Please enter both locations.");

    setIsLoading(true);
    setHotels([]);
    try {
      const oParsed = parseCoords(o);
      const dParsed = parseCoords(d);

      const [oHits, dHits] = await Promise.all([
        oParsed ? Promise.resolve([oParsed]) : photonGeocode(o),
        dParsed ? Promise.resolve([dParsed]) : photonGeocode(d),
      ]);

      const oBest = oHits[0];
      const dBest = dHits[0];
      if (!oBest || !dBest) throw new Error("Could not find those locations");

      setOrigin(oBest);
      setDest(dBest);

      const r = await osrmRoute(oBest, dBest);
      setRoute(r);

      // Hotels: near midpoint + near destination (best for booking)
      setHotelLoading(true);
      const mid = midpoint(oBest, dBest);
      const [hMid, hDest] = await Promise.all([
        overpassHotels(mid, 4500),
        overpassHotels(dBest, 6000),
      ]);
      setHotels([...hDest.slice(0, 6), ...hMid.slice(0, 4)].slice(0, 8));

      // Save recent trip
      try {
        const next = [{ o, d, t: Date.now() }, ...recentTrips]
          .filter((x, i, arr) => arr.findIndex((y) => y.o === x.o && y.d === x.d) === i)
          .slice(0, 6);
        setRecentTrips(next);
        localStorage.setItem("nr_recent", JSON.stringify(next));
      } catch {
        // ignore
      }

      toast.success("Route ready. Scroll down for map & hotels.");
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
      setHotelLoading(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return toast.error("Geolocation not supported.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setOriginText(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        toast.success("Current location added. Click Plan route.");
      },
      () => toast.error("Location permission denied."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const heroStats = [
    { k: "Routing", v: "OSRM", icon: Route },
    { k: "Geocoding", v: "Photon", icon: Compass },
    { k: "Hotels", v: "Overpass", icon: Hotel },
    { k: "Ads-ready", v: "Slots", icon: Sparkles },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* HERO */}
      <section
        id="top"
        className="relative overflow-hidden noise"
        style={{
          backgroundImage: `linear-gradient(115deg, rgba(7, 12, 24, 0.82) 0%, rgba(7, 12, 24, 0.25) 55%, rgba(255, 255, 255, 0.0) 100%), url(${heroImg})`,
          backgroundSize: "cover",
          backgroundPosition: `center calc(50% + ${heroShift}px)`,
        }}
      >
        <div className="absolute inset-0" aria-hidden />

        <div className="relative mx-auto max-w-6xl px-6 py-14 md:py-20">
          {/* Top bar */}
          <TopBar
            nav={[
              { label: "Planner", href: "/#/planner" },
              { label: "Gallery", href: "/#/gallery" },
              { label: "Contact", href: "/#/contact" },
              { label: "About", href: "/#/about" },
            ]}
          />

          <div className="mt-10 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            
            {/* Explore Nepal (carousel) */}
            <div className="lg:col-span-2">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-white/70">
                    Explore Nepal
                  </div>
                  <div className="font-display text-2xl text-white md:text-3xl">
                    Peaks, jungle, temples, lakes
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-2 text-sm text-white/70">
                  <span>Drag</span>
                  <span className="text-white/40">•</span>
                  <span>Swipe</span>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                <Carousel opts={{ align: "start", loop: true }} className="relative">
                  <CarouselContent>
                    {[
                      {
                        title: "Everest Region",
                        subtitle: "Sagarmatha • Khumbu",
                        img: everestRangeImg,
                        preset: "Lukla",
                      },
                      {
                        title: "Pokhara",
                        subtitle: "Lakeside • Annapurna",
                        img: heroImg,
                        preset: "Pokhara",
                      },
                      {
                        title: "Lumbini",
                        subtitle: "Peace • heritage",
                        img: lumbiniImg,
                        preset: "Lumbini",
                      },
                      {
                        title: "Chitwan",
                        subtitle: "Jungle safari",
                        img: chitwanImg,
                        preset: "Chitwan",
                      },
                    ].map((x) => (
                      <CarouselItem key={x.title} className="md:basis-1/2 lg:basis-1/3">
                        <div className="group relative overflow-hidden rounded-3xl">
                          <div
                            className="h-44 w-full md:h-52"
                            style={{
                              backgroundImage: `linear-gradient(115deg, rgba(7, 12, 24, 0.10) 0%, rgba(7, 12, 24, 0.55) 90%), url(${x.img})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                          <div className="absolute inset-0 p-4">
                            <div className="flex h-full flex-col justify-between">
                              <div>
                                <div className="text-xs text-white/70">{x.subtitle}</div>
                                <div className="mt-1 font-display text-2xl text-white">
                                  {x.title}
                                </div>
                              </div>
                              <Button
                                className="w-fit rounded-2xl"
                                variant="secondary"
                                onClick={() => {
                                  setDestText(x.preset);
                                  toast.success("Destination set. Plan route ↓");
                                  setTimeout(() => {
                                    document
                                      .getElementById("planner")
                                      ?.scrollIntoView({ behavior: "smooth" });
                                  }, 50);
                                }}
                              >
                                Use destination
                              </Button>
                            </div>
                          </div>

                          <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/25 blur-2xl" />
                            <div className="absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-sky-400/25 blur-2xl" />
                          </div>
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="hidden md:flex bg-white/10 text-white hover:bg-white/20 border-white/20" />
                  <CarouselNext className="hidden md:flex bg-white/10 text-white hover:bg-white/20 border-white/20" />
                </Carousel>
              </div>
            </div>

            <div className="mt-10" />
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            >
              <h1 className="font-display text-4xl leading-[0.95] text-white md:text-6xl">
                Plan your Nepal trip—
                <span className="block text-primary">fast, clear, ad‑ready.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base text-white/80 md:text-lg">
                Enter your current location and destination. Get a drivable route, estimated
                time, a realistic cost range, and hotel suggestions for the journey.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-2">
                <Badge className="bg-white/10 text-white hover:bg-white/15" variant="secondary">
                  Made for Nepal tourism
                </Badge>
                <Badge className="bg-white/10 text-white hover:bg-white/15" variant="secondary">
                  Good for hotel ads
                </Badge>
                <Badge className="bg-white/10 text-white hover:bg-white/15" variant="secondary">
                  Mobile-first
                </Badge>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {heroStats.map((s) => (
                  <div
                    key={s.k}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white"
                  >
                    <div className="flex items-center gap-2 text-xs text-white/70">
                      <s.icon className="h-4 w-4" />
                      {s.k}
                    </div>
                    <div className="mt-1 font-semibold">{s.v}</div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Planner card */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
              id="planner"
              className="scroll-mt-20"
            >
              <Card className="glass shadow-mountain relative overflow-hidden rounded-3xl p-5 md:p-6">
                <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-primary/25 blur-2xl" />
                <div className="absolute -bottom-16 -left-16 h-44 w-44 rounded-full bg-sky-400/25 blur-2xl" />

                <div className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Navigation className="h-5 w-5" />
                        <h2 className="font-display text-2xl">Route Planner</h2>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Works best with city names (e.g., “Kathmandu”, “Pokhara”, “Chitwan”).
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="gap-2"
                      onClick={useMyLocation}
                      type="button"
                    >
                      <MapPinned className="h-4 w-4" />
                      Use GPS
                    </Button>
                  </div>

                  <Separator className="my-5" />

                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Your location</label>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <div className="relative">
                          <Input
                            value={originText}
                            onChange={(e) => {
                              setOriginText(e.target.value);
                              setFocusField("origin");
                            }}
                            onFocus={() => setFocusField("origin")}
                            onBlur={() => setTimeout(() => setFocusField((f) => (f === "origin" ? null : f)), 150)}
                            placeholder="Kathmandu or 27.7172, 85.3240"
                          />
                          {focusField === "origin" && originSug.length ? (
                            <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-mountain">
                              {originSug.map((p) => (
                                <button
                                  key={p.label + p.lat}
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setOriginText(p.label);
                                    setOriginSug([]);
                                    setFocusField(null);
                                  }}
                                >
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <Button
                          className="gap-2"
                          onClick={() => {
                            setOriginText("Kathmandu");
                            setDestText("Pokhara");
                            toast.success("Demo set: Kathmandu → Pokhara");
                          }}
                          type="button"
                          variant="outline"
                        >
                          <Landmark className="h-4 w-4" />
                          Demo
                        </Button>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {["Kathmandu", "Pokhara", "Bhaktapur", "Lalitpur", "Butwal"].map((x) => (
                          <Button
                            key={x}
                            type="button"
                            variant="secondary"
                            className="h-8 rounded-2xl px-3 text-xs"
                            onClick={() => setOriginText(x)}
                          >
                            {x}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Destination</label>
                      <div className="relative">
                        <Input
                          value={destText}
                          onChange={(e) => {
                            setDestText(e.target.value);
                            setFocusField("dest");
                          }}
                          onFocus={() => setFocusField("dest")}
                          onBlur={() => setTimeout(() => setFocusField((f) => (f === "dest" ? null : f)), 150)}
                          placeholder="Pokhara or Lumbini"
                        />
                        {focusField === "dest" && destSug.length ? (
                          <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-mountain">
                            {destSug.map((p) => (
                              <button
                                key={p.label + p.lat}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setDestText(p.label);
                                  setDestSug([]);
                                  setFocusField(null);
                                }}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {["Pokhara", "Chitwan", "Lumbini", "Nagarkot", "Dhulikhel"].map((x) => (
                          <Button
                            key={x}
                            type="button"
                            variant="secondary"
                            className="h-8 rounded-2xl px-3 text-xs"
                            onClick={() => setDestText(x)}
                          >
                            {x}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        onClick={() => setMode("tourist-bus")}
                        variant={mode === "tourist-bus" ? "default" : "secondary"}
                        className="gap-2"
                      >
                        <Bus className="h-4 w-4" />
                        Tourist bus
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setMode("private")}
                        variant={mode === "private" ? "default" : "secondary"}
                        className="gap-2"
                      >
                        <Wallet className="h-4 w-4" />
                        Private vehicle
                      </Button>

                      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" />
                        No sign-in
                      </div>
                    </div>

                    <Button
                      size="lg"
                      onClick={planTrip}
                      disabled={isLoading}
                      className="mt-2 h-12 gap-2 rounded-2xl"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Planning…
                        </>
                      ) : (
                        <>
                          Plan route
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-2xl"
                        onClick={async () => {
                          const url =
                            window.location.origin +
                            window.location.pathname +
                            `#/planner?o=${encodeURIComponent(originText)}&d=${encodeURIComponent(destText)}`;
                          try {
                            await navigator.clipboard.writeText(url);
                            toast.success("Share link copied");
                          } catch {
                            toast("Copy failed. Link: " + url);
                          }
                        }}
                      >
                        Share this route
                      </Button>

                      {recentTrips.length ? (
                        <div className="ml-auto text-xs text-muted-foreground">
                          Recent:
                          <span className="ml-2">
                            {recentTrips.slice(0, 2).map((x) => (
                              <button
                                key={x.t}
                                type="button"
                                className="ml-2 underline decoration-dotted hover:text-foreground"
                                onClick={() => {
                                  setOriginText(x.o);
                                  setDestText(x.d);
                                  toast.success("Loaded recent trip");
                                }}
                              >
                                {x.o} → {x.d}
                              </button>
                            ))}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Note: Routing and hotel data come from public OpenStreetMap services.
                      Results may vary.
                    </p>
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>

        {/* Diagonal cut */}
        <div
          className="relative h-16 bg-background"
          style={{ clipPath: "polygon(0 55%, 100% 0, 100% 100%, 0 100%)", marginTop: "-4rem" }}
        />
      </section>

      {/* RESULTS */}
      <section
        id="results"
        className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] px-6 py-12 md:py-16"
      >
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-100"
          style={{
            backgroundImage: `linear-gradient(115deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.72) 50%, rgba(255,255,255,0.90) 100%), url(${lakeImg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <Card className="rounded-3xl p-5 md:p-6 shadow-mountain">
            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-primary" />
              <h3 className="font-display text-2xl">Trip summary</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Distance, time, and a cost estimate (NPR). Great for travellers and hotel leads.
            </p>

            <Separator className="my-5" />

            {!route ? (
              <div className="grid gap-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-20 w-full" />
                <div className="text-sm text-muted-foreground">
                  Plan a route above to see details.
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="text-sm text-muted-foreground">From</div>
                <div className="font-medium">{origin?.label}</div>
                <div className="text-sm text-muted-foreground mt-2">To</div>
                <div className="font-medium">{dest?.label}</div>

                <Separator className="my-3" />

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-secondary px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      Estimated time
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatMins(route.durationMin)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-secondary px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Compass className="h-4 w-4" />
                      Distance
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {route.distanceKm.toFixed(1)} km
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-5 w-5 text-primary" />
                      <div>
                        <div className="text-sm font-semibold">Estimated travel cost</div>
                        <div className="text-xs text-muted-foreground">
                          Mode: {mode === "private" ? "Private vehicle" : "Tourist bus"}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold">NPR {costNpr.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Approximate</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden rounded-3xl shadow-mountain transition-transform duration-300 hover:-translate-y-0.5">
            <div className="relative h-[380px] md:h-[460px]">
              <div className="absolute inset-0">
                <MapContainer
                  center={[27.7172, 85.324] as [number, number]}
                  zoom={7}
                  scrollWheelZoom={false}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution="© OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  <FitBounds bounds={mapBounds} />

                  {route?.geometry?.length ? (
                    <Polyline
                      positions={route.geometry.map(([lat, lon]) => [lat, lon])}
                      pathOptions={{ color: "#f59e0b", weight: 5, opacity: 0.95 }}
                    />
                  ) : null}

                  {origin ? (
                    <Marker position={[origin.lat, origin.lon]}>
                      <Popup>
                        <div className="font-medium">Start</div>
                        <div className="text-xs">{origin.label}</div>
                      </Popup>
                    </Marker>
                  ) : null}

                  {dest ? (
                    <Marker position={[dest.lat, dest.lon]}>
                      <Popup>
                        <div className="font-medium">Destination</div>
                        <div className="text-xs">{dest.label}</div>
                      </Popup>
                    </Marker>
                  ) : null}

                  {hotels.map((h) => (
                    <Marker key={h.id} position={[h.lat, h.lon]}>
                      <Popup>
                        <div className="font-medium">{h.name}</div>
                        <div className="text-xs text-muted-foreground">Hotel</div>
                        {h.website ? (
                          <a
                            className="text-xs text-blue-600 underline"
                            href={h.website}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Website
                          </a>
                        ) : null}
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
              {!route ? (
                <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-background/80 to-background/40">
                  <div className="rounded-2xl border border-border bg-card/80 px-5 py-4 text-center backdrop-blur">
                    <div className="flex items-center justify-center gap-2 font-medium">
                      <MapPinned className="h-4 w-4 text-primary" />
                      Map preview
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Plan a route to draw it here.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className="relative p-5 md:p-6"
              style={{
                backgroundImage: `linear-gradient(115deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.72) 55%, rgba(255,255,255,0.88) 100%), url(${lakeImg})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Hotel className="h-5 w-5 text-primary" />
                    <h3 className="font-display text-2xl">Hotels on the way</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A starting list you can later monetize with sponsored placements.
                  </p>
                </div>
                <Badge className="bg-white/70" variant="secondary">
                  Ad slots ready
                </Badge>
              </div>

              <Separator className="my-5" />

              {hotelLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : hotels.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {hotels.map((h) => (
                    <div
                      key={h.id}
                      className="rounded-2xl border border-border bg-white/65 p-4 backdrop-blur"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold leading-tight">{h.name}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>Source: {h.source}</span>
                            {h.stars ? <span>• {h.stars}★</span> : null}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => toast("Ad slot: connect booking link later")}
                        >
                          Promote
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {h.phone ? <Badge variant="secondary">{h.phone}</Badge> : null}
                        {h.website ? (
                          <a
                            className="text-xs text-blue-700 underline"
                            href={h.website}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {h.website.replace(/^https?:\/\//, "").slice(0, 32)}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-white/65 p-5 text-sm text-muted-foreground backdrop-blur">
                  Plan a route to fetch hotels (from OpenStreetMap). If you get none, try a
                  nearby city name.
                </div>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* GALLERY */}
      <section id="gallery" className="mx-auto max-w-6xl px-6 pb-14 scroll-mt-20">
        <Card className="rounded-3xl p-6 shadow-mountain">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Gallery
              </div>
              <h3 className="font-display text-2xl">Real views of Nepal</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Use these visuals across landing pages and future ad creatives.
              </p>
            </div>
            <Badge className="bg-primary/15 text-foreground" variant="secondary">
              Fresh
            </Badge>
          </div>

          <Separator className="my-6" />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Pokhara • Phewa Lake", img: heroImg },
              { title: "Nepal Lake Horizon", img: lakeImg },
              { title: "Everest Range", img: everestRangeImg },
              { title: "Mount Everest", img: everestImg },
              { title: "Lumbini", img: lumbiniImg },
              { title: "Chitwan", img: chitwanImg },
            ].map((x) => (
              <div key={x.title} className="group overflow-hidden rounded-3xl border border-border bg-card">
                <div
                  className="h-44 w-full transition-transform duration-500 group-hover:scale-[1.04]"
                  style={{
                    backgroundImage: `linear-gradient(115deg, rgba(7, 12, 24, 0.10) 0%, rgba(7, 12, 24, 0.55) 90%), url(${x.img})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <div className="p-4">
                  <div className="font-semibold">{x.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">High-resolution background</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* CONTACT */}
      <section id="contact" className="mx-auto max-w-6xl px-6 pb-14 scroll-mt-20">
        <Card className="rounded-3xl p-6 shadow-mountain dhaka">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Contact
              </div>
              <h3 className="font-display text-2xl">Partner with us</h3>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Want your hotel listed prominently later? Share your hotel name, location, and booking link.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex"
                href="mailto:info@yourdomain.com?subject=Hotel%20Partnership%20-%20Nepal%20Route%20Planner"
              >
                <Button className="rounded-2xl">Email us</Button>
              </a>
              <a className="inline-flex" href="tel:+9779800000000">
                <Button variant="secondary" className="rounded-2xl">Call</Button>
              </a>
              <a
                className="inline-flex"
                href="https://wa.me/9779800000000"
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline" className="rounded-2xl">WhatsApp</Button>
              </a>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-sm font-semibold">For hotels</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Send your Google Maps pin + photos + price range.
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-sm font-semibold">For agencies</div>
              <div className="mt-1 text-sm text-muted-foreground">
                We can add trekking routes, permits, and guides.
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-sm font-semibold">For ads (later)</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Sponsored slots + click tracking will be enabled.
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ADS SECTION */}
      <section id="ads" className="mx-auto max-w-6xl px-6 pb-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <Card
            className="relative overflow-hidden rounded-3xl p-6 shadow-mountain transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_90px_rgba(3,7,18,0.28)]"
            style={{
              backgroundImage: `linear-gradient(115deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.78) 55%, rgba(255,255,255,0.9) 100%), url(${everestImg})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h3 className="font-display text-2xl">Sponsored hotel spots</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This block is designed for ads (later you can connect real hotel partners,
              prices, and booking links).
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { title: "Featured Hotel #1", tag: "Top pick" },
                { title: "Featured Hotel #2", tag: "Best value" },
                { title: "Featured Hotel #3", tag: "Lake view" },
                { title: "Featured Hotel #4", tag: "Family" },
              ].map((x) => (
                <div
                  key={x.title}
                  className="rounded-2xl border border-border bg-secondary p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{x.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Placeholder ad card
                      </div>
                    </div>
                    <Badge className="bg-primary/15 text-foreground" variant="secondary">
                      {x.tag}
                    </Badge>
                  </div>
                  <Button
                    className="mt-4 w-full rounded-xl"
                    onClick={() => toast("Connect your ad click tracking later")}
                  >
                    View deal
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="rounded-3xl p-6 shadow-mountain">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h3 className="font-display text-2xl">Built for real traffic</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              A simple, fast page that can handle ad campaigns: clear CTA, strong visuals,
              and quick results.
            </p>

            <div className="mt-5 grid gap-3">
              {[
                {
                  icon: Navigation,
                  title: "Instant route preview",
                  desc: "Map + summary after one click.",
                },
                { icon: Wallet, title: "Cost estimate", desc: "Private vs tourist bus." },
                {
                  icon: Hotel,
                  title: "Hotel discovery",
                  desc: "Powered by OpenStreetMap data.",
                },
                {
                  icon: Clock,
                  title: "Time estimate",
                  desc: "Based on routing engine duration.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/15">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">{f.title}</div>
                    <div className="text-sm text-muted-foreground">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ABOUT / FOOTER */}
      <section id="about" className="mx-auto max-w-6xl px-6 pb-16">
        <Card className="rounded-3xl p-6 shadow-mountain">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <Route className="h-5 w-5 text-primary" />
                <h3 className="font-display text-2xl">About this webapp</h3>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                This is a production-ready *frontend* starter for a Nepal tourism route
                planner. Next step is connecting a hotel booking provider (affiliate links,
                pricing, availability) and adding analytics for ads.
              </p>
            </div>

            <Button
              variant="outline"
              className="rounded-2xl"
              onClick={() => document.getElementById("planner")?.scrollIntoView({ behavior: "smooth" })}
            >
              Back to planner
            </Button>
          </div>

          <Separator className="my-6" />

          <div className="grid gap-4 text-xs text-muted-foreground md:grid-cols-3">
            <div>
              <div className="font-semibold text-foreground">Data sources</div>
              <div className="mt-1">OpenStreetMap (tiles, Overpass), OSRM, Photon.</div>
            </div>
            <div>
              <div className="font-semibold text-foreground">Ad expansion</div>
              <div className="mt-1">Sponsored cards, filters, booking CTAs, tracking.</div>
            </div>
            <div>
              <div className="font-semibold text-foreground">Disclaimer</div>
              <div className="mt-1">
                Times & costs are estimates. Always confirm with local conditions.
              </div>
            </div>
          </div>
        </Card>

        <div className="mt-8 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Nepal Route Planner — built for tourism growth.
        </div>
      </section>

      {/* Mobile quick actions */}
      <div className="fixed bottom-4 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 md:hidden">
        <div className="glass shadow-mountain flex items-center justify-between gap-2 rounded-2xl px-3 py-2">
          <Button
            variant="secondary"
            className="h-10 flex-1 rounded-xl"
            onClick={() => document.getElementById("planner")?.scrollIntoView({ behavior: "smooth" })}
          >
            Planner
          </Button>
          <Button
            variant="secondary"
            className="h-10 flex-1 rounded-xl"
            onClick={() => document.getElementById("ads")?.scrollIntoView({ behavior: "smooth" })}
          >
            Hotel Ads
          </Button>
          <Button
            className="h-10 flex-1 rounded-xl"
            onClick={() => document.getElementById("planner")?.scrollIntoView({ behavior: "smooth" })}
          >
            Plan
          </Button>
        </div>
      </div>
    </div>
  );
}
