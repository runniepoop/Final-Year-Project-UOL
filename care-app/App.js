// Care: A Simulation — role select -> scenario select -> four minigames
// Responsive layout. Each scenario is its own room; server enforces 1 caretaker + 1 patient.
// No new libraries (socket.io-client + core React Native only).

import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { io } from "socket.io-client";

// set to your LAN IP (from ipconfig)
const SERVER_URL = "http://192.168.1.153:3001";
const ROUND_MS = 120000; // vision movers countdown (2:00)

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const U = Math.min(SCREEN_W, 440); // responsive base unit

// responsive scaling
const BASE_W = 390;                                            // reference iPhone width
const GS = Math.min(Math.max(SCREEN_W / BASE_W, 1), 2.6);      // 1 on iPhone, up to 2.6 on iPad
const rs = (n) => Math.round(n * GS);                          // scale one raw pixel value
const SCALE_KEYS = new Set(["fontSize","lineHeight","letterSpacing","padding","paddingHorizontal","paddingVertical","paddingTop","paddingBottom","paddingLeft","paddingRight","margin","marginHorizontal","marginVertical","marginTop","marginBottom","marginLeft","marginRight","borderRadius","borderTopLeftRadius","borderTopRightRadius","borderBottomLeftRadius","borderBottomRightRadius","borderWidth","width","height","minWidth","minHeight","maxWidth","maxHeight","gap","top","left","right","bottom"]);
function scaleStyles(obj) {                                    
  const out = {};
  for (const name in obj) {
    const st = obj[name], ns = {};
    for (const key in st) { const v = st[key]; ns[key] = (typeof v === "number" && SCALE_KEYS.has(key)) ? Math.round(v * GS) : v; }
    out[name] = ns;
  }
  return out;
}

/* ---- scenarios (role-specific descriptions) ------------------------------ */
const SCENARIOS = [
  { id: "vision",  name: "Vision loss",       ready: true, desc: { caretaker: "Help your patient sort a shelf",            patient: "Sort a shelf with the help of your caretaker" } },
  { id: "hearing", name: "Hearing loss",      ready: true, desc: { caretaker: "Guide a patient to solve a puzzle",         patient: "Crack a code with the help of your caretaker" } },
  { id: "motor",   name: "Motor difficulty",  ready: true, desc: { caretaker: "Support your patient to unlock a phone",    patient: "Unlock a phone with unsteady touch" } },
  { id: "speech",  name: "Speech difficulty", ready: true, desc: { caretaker: "Find out what your patient needs",          patient: "Communicate your needs with your caretaker" } },
];

/* ---- vision items -------------------------------------------------------- */
const ITEMS = [
  { slot: 0, name: "Mug",        bin: "kitchen",  color: "#C9A24B", image: require("./assets/items/mug.png") },
  { slot: 1, name: "Towel",      bin: "bathroom", color: "#6FA0AE", image: require("./assets/items/towel.png") },
  { slot: 2, name: "Pillow",     bin: "bedroom",  color: "#B48AC2", image: require("./assets/items/pillow.png") },
  { slot: 3, name: "Frying pan", bin: "kitchen",  color: "#7C7A75", image: require("./assets/items/pan.png") },
  { slot: 4, name: "Toothbrush", bin: "bathroom", color: "#D98A6A", image: require("./assets/items/toothbrush.png") },
  { slot: 5, name: "Lamp",       bin: "bedroom",  color: "#C7B24B", image: require("./assets/items/lamp.png") },
];
const BINS = [ { id: "kitchen", name: "Kitchen" }, { id: "bathroom", name: "Bathroom" }, { id: "bedroom", name: "Bedroom" } ];
const POS = ["top shelf, left", "top shelf, middle", "top shelf, right",
             "bottom shelf, left", "bottom shelf, middle", "bottom shelf, right"];

/* ---- hearing puzzle: 4 tiles = 2 numbers + 2 shapes, tapped in a 4-order -- */
const HSEQ = 4;
const SHAPE_TYPES = ["circle", "square", "triangle", "diamond"];
const TILE_COLORS = ["#C4574B", "#3F6B8A", "#4E8A5B", "#C98A2F", "#8A5E9E", "#4E7C8A"];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function genHearingTiles() {
  const nums = shuffle(["1", "2", "3", "4", "5", "6", "7", "8", "9"]).slice(0, 3);
  const shapes = shuffle(SHAPE_TYPES).slice(0, 3);
  const cols = shuffle(TILE_COLORS).slice(0, 6);
  const tiles = [
    { kind: "num", label: nums[0], color: cols[0] },
    { kind: "num", label: nums[1], color: cols[1] },
    { kind: "num", label: nums[2], color: cols[2] },
    { kind: "shape", shape: shapes[0], color: cols[3] },
    { kind: "shape", shape: shapes[1], color: cols[4] },
    { kind: "shape", shape: shapes[2], color: cols[5] },
  ];
  return shuffle(tiles);
}
function genPerm(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return shuffle(a); }
function tileDesc(t) { return t ? (t.kind === "num" ? `the number ${t.label}` : `the ${t.shape}`) : ""; }

/* ---- motor: drag pieces into slots to unlock a phone (over-sensitive) ----- */
// sizes fit the screen (no scrolling). Tune SENS / JITTER / TOL for difficulty.
const PHONE_H = Math.round(Math.min(SCREEN_W * 0.74 * 1.72, SCREEN_H * 0.60)); // scales up on larger screens
const PHONE_W = Math.round(PHONE_H / 1.72);
const PIECE = Math.round(PHONE_W * 0.26);
const HOME = { x: PHONE_W / 2 - PIECE / 2, y: PHONE_H - PIECE - 16 };
const SENS = 1.0;     // movement amplification (harder to control)
const JITTER = 10;     // random wobble per move (px)
const TOL = Math.round(PIECE * 0.28); // how close to the slot centre counts (smaller = harder). Adjust 0.42.
const MPIECES = [ { shape: "circle", color: "#4E8A5B" }, { shape: "triangle", color: "#C98A2F" }, { shape: "square", color: "#3F6B8A" } ];
// three random, non-overlapping slot positions in the upper area of the phone
function genSlots() {
  const margin = 14;
  const minX = margin, maxX = PHONE_W - PIECE - margin;
  const minY = margin, maxY = Math.round(PHONE_H * 0.60) - PIECE;
  const out = [];
  let tries = 0;
  while (out.length < MPIECES.length && tries < 500) {
    tries++;
    const x = minX + Math.random() * Math.max(1, maxX - minX);
    const y = minY + Math.random() * Math.max(1, maxY - minY);
    const ok = out.every((p) => Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)) > PIECE + 18);
    if (ok) out.push({ x, y });
  }
  while (out.length < MPIECES.length) out.push({ x: minX + out.length * (PIECE + 20), y: minY });
  return out;
}

/* ---- speech ------------------------------------------------------------- */
const NEEDS = [
  { id: "water",    name: "Water",    color: "#4E7C8A" },
  { id: "blanket",  name: "Blanket",  color: "#8A5E9E" },
  { id: "toilet",   name: "Toilet",   color: "#3F6B5E" },
  { id: "medicine", name: "Medicine", color: "#B5463A" },
  { id: "window",   name: "Window",   color: "#C0863C" },
  { id: "light",    name: "Light",    color: "#C7A24B" },
];
const RESPONSES = [
  { val: "yes",    label: "Yes",    color: "#4E8A5B" },
  { val: "no",     label: "No",     color: "#B5463A" },
  { val: "unsure", label: "Unsure", color: "#8B867C" },
];
function needName(id) { const n = NEEDS.find((x) => x.id === id); return n ? n.name : ""; }

/* ---- design tokens ------------------------------------------------------- */
const C = {
  bg: "#EDEAE3", panel: "#F6F4EF", ink: "#23221F", muted: "#8B867C", line: "#D8D3C9",
  care: "#3F6B5E", patient: "#B5623F", ok: "#4E8A5B", bad: "#B5463A", white: "#FFFFFF",
  wood: "#9C7A55", woodEdge: "#835F3C", pick: "#FFD23F", phone: "#2A2E33",
};
const BIN_COLOR = { kitchen: "#C0863C", bathroom: "#4E7C8A", bedroom: "#8A5E9E" };
const MONO = Platform.select({ ios: "Courier", android: "monospace", default: "monospace" });

/* ---- small shared components -------------------------------------------- */
function Shape({ type, size = 30, color = "#fff" }) {
  if (type === "circle") return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  if (type === "square") return <View style={{ width: size, height: size, borderRadius: 4, backgroundColor: color }} />;
  if (type === "diamond") return <View style={{ width: size * 0.78, height: size * 0.78, borderRadius: 4, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />;
  if (type === "triangle") return <View style={{ width: 0, height: 0, borderLeftWidth: size / 2, borderRightWidth: size / 2, borderBottomWidth: size, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color }} />;
  return null;
}
function TileFace({ tile, size = 54 }) {
  if (!tile) return null;
  return tile.kind === "num"
    ? <Text style={{ fontSize: size * 0.5, fontWeight: "800", color: "#fff" }}>{tile.label}</Text>
    : <Shape type={tile.shape} size={size * 0.55} color="#fff" />;
}

/* ---- vision pixel placeholder + shelf ----------------------------------- */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function PixelBlob({ color, size = 70, cells = 5, seed = 1 }) {
  const cs = size / cells, rows = [];
  for (let y = 0; y < cells; y++) { const row = [];
    for (let x = 0; x < cells; x++) {
      const k = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + seed * 3.17) * 43758.5453;
      const f = ((k - Math.floor(k)) - 0.5) * 0.5;
      row.push(<View key={x} style={{ width: cs, height: cs, backgroundColor: shade(color, f) }} />);
    }
    rows.push(<View key={y} style={{ flexDirection: "row" }}>{row}</View>);
  }
  return <View style={{ width: size, height: size, overflow: "hidden", borderRadius: 6 }}>{rows}</View>;
}
function ItemView({ item, role, done, selected, wrong }) {
  const border = selected ? { borderColor: C.pick, borderWidth: 4 }
    : wrong ? { borderColor: C.bad, borderWidth: 4 } : { borderColor: "transparent", borderWidth: 4 };
  if (done) return <View style={[s.slot, s.slotDone]}><Text style={s.slotDoneMark}>✓</Text></View>;
  const clear = role === "caretaker";
  return (
    <View style={[s.slot, border]}>
      {item.image ? (
        <View style={s.imgWrap}>
          <Image source={item.image} style={s.img} resizeMode="contain" blurRadius={clear ? 0 : 11} />
          {!clear && <View style={s.dim} />}
        </View>
      ) : clear ? (
        <View style={[s.ph, { backgroundColor: item.color }]}><Text style={s.phLetter}>{item.name[0]}</Text></View>
      ) : (
        <PixelBlob color={item.color} seed={item.slot + 1} />
      )}
    </View>
  );
}
function ShelfScene({ role, items, placed, selected, flash, onItem }) {
  const rowFor = (slots) => (
    <View style={s.shelfUnit}>
      <View style={s.shelfRow}>
        {slots.map((i) => {
          const item = items[i], done = placed[i] != null;
          const node = <ItemView item={item} role={role} done={done}
            selected={selected === i} wrong={flash && flash.slot === i && !flash.ok} />;
          return role === "patient" ? (
            <Pressable key={i} disabled={done} onPress={() => onItem(i)} style={s.slotTap}>{node}</Pressable>
          ) : (
            <View key={i} style={s.slotTap}>{node}
              <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
              <View style={[s.miniTag, { backgroundColor: done ? C.ok : BIN_COLOR[item.bin] }]}>
                <Text style={s.miniTagText}>{done ? "done" : binName(item.bin)}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={s.plank} /><View style={s.plankEdge} />
    </View>
  );
  return <View>{rowFor([0, 1, 2])}{rowFor([3, 4, 5])}</View>;
}
function BoxRow({ role, placed, selected, onBox }) {
  const counts = {}; Object.values(placed).forEach((b) => (counts[b] = (counts[b] || 0) + 1));
  return (
    <View style={s.boxRow}>
      {BINS.map((b) => {
        const active = role === "patient" && selected != null;
        return (
          <Pressable key={b.id} disabled={!active} onPress={() => onBox(b.id)}
            style={[s.box, { borderColor: BIN_COLOR[b.id] }, active && s.boxActive]}>
            <View style={[s.boxLip, { backgroundColor: BIN_COLOR[b.id] }]} />
            <Text style={s.boxName}>{b.name}</Text>
            <Text style={s.boxCount}>{counts[b.id] || 0}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function binName(id) { return BINS.find((b) => b.id === id).name; }
function fmt(ms) { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }

// ===========================================================================
export default function App() {
  const [role, setRole] = useState(null);
  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState("offline");
  const [ready, setReady] = useState(false);
  // vision
  const [placed, setPlaced] = useState({});
  const [selected, setSelected] = useState(null);
  const [flash, setFlash] = useState(null);
  const [endsAt, setEndsAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [result, setResult] = useState(null);
  const [vPerm, setVPerm] = useState([0, 1, 2, 3, 4, 5]);
  // hearing
  const [hTiles, setHTiles] = useState([]);
  const [hTarget, setHTarget] = useState([]);
  const [hTaps, setHTaps] = useState([]);
  const [hFlash, setHFlash] = useState(null);
  const [hWon, setHWon] = useState(false);
  const [hStarted, setHStarted] = useState(false);
  // motor
  const socketRef = useRef(null);
  const offsetRef = useRef(HOME);
  const baseRef = useRef(HOME);
  const idxRef = useRef(0);
  const mSlotsRef = useRef([]);
  const lastMoveRef = useRef(0);
  const [mSlots, setMSlots] = useState([]);
  const [mOffset, setMOffset] = useState(HOME);
  const [mIndex, setMIndex] = useState(0);
  const [mWon, setMWon] = useState(false);
  const [mStarted, setMStarted] = useState(false);
  const [mFlash, setMFlash] = useState(null);
  // speech
  const [sTarget, setSTarget] = useState(null);
  const [sAnswer, setSAnswer] = useState(null);
  const [sWrong, setSWrong] = useState(0);
  const [sWon, setSWon] = useState(false);
  const [sStarted, setSStarted] = useState(false);
  const [sFlash, setSFlash] = useState(null);
  const [sIncoming, setSIncoming] = useState(null);
  const [sFailed, setSFailed] = useState(false);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { baseRef.current = offsetRef.current; },
      onPanResponderMove: (e, g) => {
        let nx = baseRef.current.x + g.dx * SENS + (Math.random() - 0.5) * JITTER;
        let ny = baseRef.current.y + g.dy * SENS + (Math.random() - 0.5) * JITTER;
        nx = Math.max(0, Math.min(PHONE_W - PIECE, nx));
        ny = Math.max(0, Math.min(PHONE_H - PIECE, ny));
        offsetRef.current = { x: nx, y: ny };
        setMOffset(offsetRef.current);
        const now = Date.now();
        if (now - lastMoveRef.current > 40) { lastMoveRef.current = now; socketRef.current && socketRef.current.emit("action", { type: "mmove", x: nx, y: ny }); }
      },
      onPanResponderRelease: () => {
        const i = idxRef.current;
        const slots = mSlotsRef.current;
        if (i >= MPIECES.length || !slots[i]) return;
        const cx = offsetRef.current.x + PIECE / 2, cy = offsetRef.current.y + PIECE / 2;
        const t = slots[i]; const tx = t.x + PIECE / 2, ty = t.y + PIECE / 2;
        const d = Math.sqrt((cx - tx) * (cx - tx) + (cy - ty) * (cy - ty));
        offsetRef.current = HOME; setMOffset(HOME);
        socketRef.current && socketRef.current.emit("action", { type: "mmove", x: HOME.x, y: HOME.y });
        if (d < TOL) {
          const ni = i + 1; idxRef.current = ni; setMIndex(ni);
          socketRef.current && socketRef.current.emit("action", { type: "mprog", index: ni });
          if (ni >= MPIECES.length) { setMWon(true); socketRef.current && socketRef.current.emit("action", { type: "mwin" }); }
        } else { setMFlash("miss"); setTimeout(() => setMFlash(null), 500); }
      },
    })
  ).current;

  const vItems = vPerm.map((idx) => ITEMS[idx]);
  const visionWon = Object.keys(placed).length === ITEMS.length;
  const won = room === "hearing" ? hWon : room === "motor" ? mWon : room === "speech" ? sWon : visionWon;
  const started = room === "hearing" ? hStarted : room === "motor" ? mStarted : room === "speech" ? sStarted : (endsAt != null);
  const scenario = SCENARIOS.find((x) => x.id === room);

  useEffect(() => {
    if (!role || !room) return;
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => { setStatus("connecting"); socket.emit("join", { room, role }); });
    socket.on("joined", ({ partnerPresent }) => setStatus(partnerPresent ? "ready" : "waiting"));
    socket.on("ready", () => { setReady(true); setStatus("ready"); });
    socket.on("roleTaken", () => setStatus("full"));
    socket.on("partnerLeft", () => { setReady(false); setStatus("waiting"); });
    socket.on("connect_error", () => setStatus("no-server"));
    socket.on("action", (m) => {
      // vision
      if (m.type === "select") setSelected(m.slot);
      if (m.type === "place") { if (m.correct) setPlaced((p) => ({ ...p, [m.slot]: m.binId })); setSelected(null); setFlash({ slot: m.slot, ok: m.correct }); setTimeout(() => setFlash(null), 750); }
      if (m.type === "start") { setVPerm(m.perm || [0, 1, 2, 3, 4, 5]); setPlaced({}); setSelected(null); setFlash(null); setResult(null); setEndsAt(Date.now() + ROUND_MS); }
      if (m.type === "reset") { setPlaced({}); setSelected(null); setFlash(null); setResult(null); setEndsAt(null); }
      // hearing
      if (m.type === "hstart") { setHTiles(m.tiles || []); setHTaps([]); setHFlash(null); setHWon(false); setHStarted(true); }
      if (m.type === "hreset") { setHTiles([]); setHTarget([]); setHTaps([]); setHFlash(null); setHWon(false); setHStarted(false); }
      if (m.type === "htap") setHTaps((t) => [...t, m.tile]);
      if (m.type === "hclear") setHTaps([]);
      if (m.type === "hwin") { setHWon(true); setHFlash("win"); setTimeout(() => setHFlash(null), 700); }
      if (m.type === "hwrong") { setHTaps([]); setHFlash("wrong"); setTimeout(() => setHFlash(null), 700); }
      // motor
      if (m.type === "mstart") { mSlotsRef.current = m.slots || []; setMSlots(m.slots || []); idxRef.current = 0; offsetRef.current = HOME; setMOffset(HOME); setMIndex(0); setMWon(false); setMFlash(null); setMStarted(true); }
      if (m.type === "mreset") { mSlotsRef.current = []; setMSlots([]); idxRef.current = 0; offsetRef.current = HOME; setMOffset(HOME); setMIndex(0); setMWon(false); setMFlash(null); setMStarted(false); }
      if (m.type === "mmove") setMOffset({ x: m.x, y: m.y });
      if (m.type === "mprog") { setMIndex(m.index); setMOffset(HOME); }
      if (m.type === "mwin") setMWon(true);
      // speech
      if (m.type === "sstart") { setSAnswer(null); setSWrong(0); setSWon(false); setSFailed(false); setSFlash(null); setSIncoming(null); setSStarted(true); if (role === "patient") setSTarget(NEEDS[Math.floor(Math.random() * NEEDS.length)].id); }
      if (m.type === "sreset") { setSAnswer(null); setSWrong(0); setSWon(false); setSFailed(false); setSFlash(null); setSIncoming(null); setSStarted(false); setSTarget(null); }
      if (m.type === "sanswer") setSAnswer(m.val);
      if (m.type === "sguess") setSIncoming(m.item);
      if (m.type === "sresult") { if (m.ok) setSWon(true); else { setSWrong((w) => w + 1); setSFlash("wrong"); setTimeout(() => setSFlash(null), 700); } }
      if (m.type === "sfail") setSFailed(true);
    });
    return () => socket.disconnect();
  }, [role, room]);

  useEffect(() => { if (!endsAt || won) return; const id = setInterval(() => setNowTick(Date.now()), 250); return () => clearInterval(id); }, [endsAt, won]);
  useEffect(() => { if (won && endsAt && !result) { const msLeft = Math.max(0, endsAt - Date.now()); setResult({ msLeft, overtime: msLeft === 0 }); } }, [won, endsAt, result]);

  const relay = (p) => socketRef.current && socketRef.current.emit("action", p);

  // hearing win-check (caretaker authority)
  useEffect(() => {
    if (room !== "hearing" || role !== "caretaker" || hWon) return;
    if (hTarget.length === 0 || hTaps.length < hTarget.length) return;
    const ok = hTaps.every((t, i) => t === hTarget[i]);
    if (ok) { setHWon(true); setHFlash("win"); relay({ type: "hwin" }); }
    else { setHFlash("wrong"); relay({ type: "hwrong" }); setHTaps([]); }
    const id = setTimeout(() => setHFlash(null), 700); return () => clearTimeout(id);
  }, [hTaps, hTarget, room, role, hWon]);

  // speech: patient checks caretaker's guess
  useEffect(() => {
    if (role !== "patient" || sIncoming == null || sTarget == null) return;
    const ok = sIncoming === sTarget;
    relay({ type: "sresult", ok, item: sIncoming });
    if (ok) setSWon(true);
    setSIncoming(null);
  }, [sIncoming, sTarget, role]);

  // speech: caretaker runs out of tries (3)
  useEffect(() => {
    if (role === "caretaker" && room === "speech" && sWrong >= 3 && !sWon && !sFailed) { setSFailed(true); relay({ type: "sfail" }); }
  }, [sWrong, role, room, sWon, sFailed]);

  const startRound = () => {
    if (room === "hearing") { const tiles = genHearingTiles(); const target = shuffle(tiles.map((_, i) => i)).slice(0, HSEQ); setHTiles(tiles); setHTarget(target); setHTaps([]); setHFlash(null); setHWon(false); setHStarted(true); relay({ type: "hstart", tiles }); return; }
    if (room === "motor") { const slots = genSlots(); mSlotsRef.current = slots; setMSlots(slots); idxRef.current = 0; offsetRef.current = HOME; setMOffset(HOME); setMIndex(0); setMWon(false); setMFlash(null); setMStarted(true); relay({ type: "mstart", slots }); return; }
    if (room === "speech") { setSAnswer(null); setSWrong(0); setSWon(false); setSFailed(false); setSFlash(null); setSIncoming(null); setSStarted(true); if (role === "patient") setSTarget(NEEDS[Math.floor(Math.random() * NEEDS.length)].id); relay({ type: "sstart" }); return; }
    const perm = shuffle([0, 1, 2, 3, 4, 5]); setVPerm(perm); setPlaced({}); setSelected(null); setFlash(null); setResult(null); setEndsAt(Date.now() + ROUND_MS); relay({ type: "start", perm });
  };
  const newRound = () => {
    if (room === "hearing") { setHTiles([]); setHTarget([]); setHTaps([]); setHFlash(null); setHWon(false); setHStarted(false); relay({ type: "hreset" }); return; }
    if (room === "motor") { mSlotsRef.current = []; setMSlots([]); idxRef.current = 0; offsetRef.current = HOME; setMOffset(HOME); setMIndex(0); setMWon(false); setMFlash(null); setMStarted(false); relay({ type: "mreset" }); return; }
    if (room === "speech") { setSAnswer(null); setSWrong(0); setSWon(false); setSFailed(false); setSFlash(null); setSIncoming(null); setSStarted(false); setSTarget(null); relay({ type: "sreset" }); return; }
    setPlaced({}); setSelected(null); setFlash(null); setResult(null); setEndsAt(null); relay({ type: "reset" });
  };
  const resetSession = () => {
    setPlaced({}); setSelected(null); setFlash(null); setReady(false); setStatus("offline"); setEndsAt(null); setResult(null);
    setHTiles([]); setHTarget([]); setHTaps([]); setHFlash(null); setHWon(false); setHStarted(false);
    idxRef.current = 0; offsetRef.current = HOME; mSlotsRef.current = []; setMSlots([]); setMOffset(HOME); setMIndex(0); setMWon(false); setMFlash(null); setMStarted(false);
    setSTarget(null); setSAnswer(null); setSWrong(0); setSWon(false); setSFailed(false); setSFlash(null); setSIncoming(null); setSStarted(false);
  };
  const backToScenarios = () => { resetSession(); setRoom(null); };
  const backToRoles = () => { resetSession(); setRoom(null); setRole(null); };

  const tapItem = (slot) => { if (placed[slot] != null || !ready) return; setSelected(slot); relay({ type: "select", slot }); };
  const tapBox = (binId) => {
    if (selected == null || !ready) return;
    const correct = vItems[selected].bin === binId;
    if (correct) setPlaced((p) => ({ ...p, [selected]: binId }));
    setFlash({ slot: selected, ok: correct }); setTimeout(() => setFlash(null), 750);
    relay({ type: "place", slot: selected, binId, correct }); setSelected(null);
  };
  const hTap = (tile) => { if (!hStarted || hWon || role !== "patient" || hTaps.length >= HSEQ || hTaps.includes(tile)) return; setHTaps((t) => [...t, tile]); relay({ type: "htap", tile }); };
  const hClear = () => { setHTaps([]); relay({ type: "hclear" }); };
  const sReply = (val) => { if (!sStarted || sWon || role !== "patient") return; setSAnswer(val); relay({ type: "sanswer", val }); };
  const sGuess = (item) => { if (!sStarted || sWon || sFailed || role !== "caretaker") return; relay({ type: "sguess", item }); };

  const accent = role === "caretaker" ? C.care : C.patient;
  const statusText = { offline: "offline", connecting: "connecting…", waiting: "waiting", ready: "connected", full: "full", "no-server": "no server" }[status] || status;
  const remaining = (endsAt != null) ? Math.max(0, endsAt - nowTick) : ROUND_MS;
  const timeUp = endsAt != null && remaining === 0;
  const low = endsAt != null && remaining <= 20000;

  const INTRO = {
    vision: { kicker: "VISION LOSS", title: "Packing my belongings", note: null,
      obj: { caretaker: "Objective: Communicate with your visually impaired patient to pack all six items into the allocated boxes within 2 minutes, before the van arrives.",
             patient: "Objective: With the aid of your caretaker's instructions, pack six items into their respective boxes." } },
    hearing: { kicker: "HEARING LOSS", title: "Show, don't tell", note: "Patient: put on noise-cancelling earbuds or headphones and play music before the round starts.",
      obj: { caretaker: "Objective: Without speaking, get your patient to tap the four tiles in the right order. Point, gesture, or count on your fingers.",
             patient: "Objective: You cannot hear your caretaker. Watch them and tap the four tiles in the order they show you." } },
    motor: { kicker: "MOTOR DIFFICULTY", title: "Unsteady hands", note: "Patient: use your non-dominant hand this round to feel the difficulty.",
      obj: { caretaker: "Objective: Support your patient as they drag each piece into place. Their touch is unsteady and over-sensitive, so guide them and be patient.",
             patient: "Objective: Drag each puzzle piece into its slot to unlock the phone. The touch is jumpy, so move slowly and carefully." } },
    speech: { kicker: "SPEECH DIFFICULTY", title: "What I need", note: null,
      obj: { caretaker: "Objective: Your patient can only reply Yes, No, or Unsure. Ask yes/no questions aloud to work out what they need, then tap your guess.",
             patient: "Objective: You have a need you cannot say. Answer your caretaker's questions using only Yes, No, or Unsure." } },
  };
  const patientHint =
    room === "hearing" ? (!ready ? "Waiting for the caretaker…" : won ? "Nicely done. Wait for the next round." : "Tap the tiles in the order shown to you.")
    : room === "motor" ? (!ready ? "Waiting for the caretaker…" : won ? "Unlocked. Wait for the next round." : "Drag each piece into its slot.")
    : room === "speech" ? (!ready ? "Waiting for the caretaker…" : sFailed ? "Out of tries. Wait for a new round." : won ? "They understood you. Wait for the next round." : "Reply with Yes, No, or Unsure.")
    : (!ready ? "Waiting for the caretaker…" : won ? "All packed. Wait for the next round." : selected != null ? "Item picked. Check with your partner, then tap a box." : "Tap the item your partner describes.");
  const startHint =
    room === "hearing" ? "Start once your partner has their headphones on."
    : room === "motor" ? "Start when your partner is ready to try."
    : room === "speech" ? "Start when your partner is ready to answer."
    : "Press Start when you are both ready.";

  // ---------- 1) ROLE SELECT ----------
  if (!role) {
    return (
      <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
        <StatusBar barStyle="dark-content" />
        <View style={s.roleHead}>
          <Text style={s.kicker}>CARE : A SIMULATION</Text>
          <Text style={s.roleTitle}>Choose your role</Text>
          <Text style={s.roleSub}>Two phones, one scenario.</Text>
          <Text style={s.roleSub}>Pick a role each to begin.</Text>
        </View>
        <Pressable style={[s.rolePanel, { backgroundColor: C.care }]} onPress={() => setRole("caretaker")}>
          <Text style={s.roleName}>Caretaker</Text>
        </Pressable>
        <Pressable style={[s.rolePanel, { backgroundColor: C.patient }]} onPress={() => setRole("patient")}>
          <Text style={s.roleName}>Patient</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ---------- 2) SCENARIO SELECT ----------
  if (!room) {
    return (
      <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
        <StatusBar barStyle="dark-content" />
        <View style={s.selHead}>
          <Pressable onPress={backToRoles} hitSlop={10}><Text style={s.back}>‹ role</Text></Pressable>
          <View style={[s.chip, { backgroundColor: accent, marginTop: 8 }]}><Text style={s.chipText}>{role.toUpperCase()}</Text></View>
          <Text style={s.selTitle}>Choose a scenario</Text>
          <Text style={s.selSub}>Each scenario is its own room. Both of you must pick the same one.</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}>
          {SCENARIOS.map((sc, i) => (
            <Pressable key={sc.id} disabled={!sc.ready} onPress={() => setRoom(sc.id)} style={[s.scCard, !sc.ready && s.scCardOff]}>
              <View style={[s.scIndex, { backgroundColor: sc.ready ? accent : C.muted }]}><Text style={s.scIndexText}>{String(i + 1).padStart(2, "0")}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[s.scName, !sc.ready && { color: C.muted }]}>{sc.name}</Text>
                <Text style={s.scTag}>{sc.desc[role]}</Text>
              </View>
              <Text style={[s.scState, { color: sc.ready ? accent : C.muted }]}>{sc.ready ? "play ›" : "soon"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------- 3a) SLOT TAKEN ----------
  if (status === "full") {
    return (
      <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
        <StatusBar barStyle="dark-content" />
        <View style={s.fullWrap}>
          <Text style={[s.doneTag, { color: C.bad }]}>SCENARIO FULL</Text>
          <Text style={s.fullBig}>Someone is already the {role} in {scenario.name}.</Text>
          <Text style={s.fullSub}>Each scenario allows one caretaker and one patient at a time. Try another scenario, or switch role.</Text>
          <Pressable style={[s.primary, { backgroundColor: C.ink, marginTop: 22 }]} onPress={backToScenarios}><Text style={s.primaryText}>Choose another scenario</Text></Pressable>
          <Pressable onPress={backToRoles} style={{ marginTop: 14 }}><Text style={s.back}>‹ change role</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- 3b) THE GAME ----------
  return (
    <SafeAreaView style={[s.fill, { backgroundColor: C.bg }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.bar}>
        <Pressable onPress={backToScenarios} hitSlop={10} style={s.barBack}><Text style={s.backSmall}>‹</Text></Pressable>
        <View style={s.barCenter}>
          <Text style={s.barScenario} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{scenario.name}</Text>
          <View style={[s.chipSm, { backgroundColor: accent }]}><Text style={s.chipSmText}>{role.toUpperCase()}</Text></View>
        </View>
        <View style={s.barStatusWrap}>
          <View style={[s.dot, { backgroundColor: ready ? C.ok : C.muted }]} />
          <Text style={s.barStatus} numberOfLines={1}>{statusText}</Text>
        </View>
      </View>

      {won ? (
        <View style={s.doneWrap}>
          {room === "vision" ? (<>
            <Text style={[s.doneTag, { color: result && result.overtime ? C.bad : accent }]}>{result && result.overtime ? "PACKED, BUT WE WERE LATE.." : "ALL PACKED IN TIME"}</Text>
            <Text style={s.doneBig}>{ITEMS.length} of {ITEMS.length} items packed.</Text>
            <Text style={s.doneSub}>{result && result.overtime ? "The van driver was waiting grumpily! However, nothing got left behind." : `Packed with ${result ? fmt(result.msLeft) : "0:00"} minutes to spare!`}</Text>
          </>) : room === "hearing" ? (<>
            <Text style={[s.doneTag, { color: accent }]}>IN SYNC</Text>
            <Text style={s.doneBig}>They followed your lead.</Text>
            <Text style={s.doneSub}>{role === "caretaker" ? "You got the order across without a word." : "You read your partner and tapped it in the right order."}</Text>
          </>) : room === "motor" ? (<>
            <Text style={[s.doneTag, { color: accent }]}>UNLOCKED</Text>
            <Text style={s.doneBig}>The phone has been unlocked.</Text>
            <Text style={s.doneSub}>{role === "caretaker" ? "You guided them through every shaky drag. Your patience paid off." : "You placed every piece into place despite the unsteady touch."}</Text>
          </>) : (<>
            <Text style={[s.doneTag, { color: accent }]}>UNDERSTOOD</Text>
            <Text style={s.doneBig}>{role === "patient" ? `They figured out what you needed` : "You worked out what they needed."}</Text>
            <Text style={s.doneSub}>{role === "caretaker" ? (sWrong === 0 ? "First guess, no wrong turns. Good questions." : `Found it after ${sWrong} wrong ${sWrong === 1 ? "guess" : "guesses"}. Yes/No questions narrow it faster.`) : "You answered clearly enough for them to narrow it down."}</Text>
          </>)}
        </View>
      ) : !started ? (
        <View style={s.body}>
          <View style={s.startWrap}>
            <Text style={s.startKicker}>{INTRO[room].kicker}</Text>
            <Text style={s.startBig}>{INTRO[room].title}</Text>
            <Text style={s.startSub}>{INTRO[room].obj[role]}</Text>
            {INTRO[room].note ? <View style={s.ruleBox}><Text style={s.ruleLine}>{INTRO[room].note}</Text></View> : null}
            {role === "caretaker" ? (
              <Pressable style={[s.primary, { backgroundColor: C.ink, marginTop: 18 }, !ready && s.primaryOff]} disabled={!ready} onPress={startRound}>
                <Text style={s.primaryText}>{ready ? (room === "vision" ? `Start packing (${fmt(ROUND_MS)})` : "Start the round") : "Waiting for patient…"}</Text>
              </Pressable>
            ) : (
              <Text style={s.startWait}>{ready ? "Ready. The caretaker will start the round." : "Waiting for the caretaker to join…"}</Text>
            )}
          </View>
        </View>
      ) : room === "vision" ? (
        <View style={s.body}>
          <Text style={s.frame}>The movers are coming. Pack every item before the van arrives.</Text>
          <View style={s.headline}>
            <Text style={s.count}>{Object.keys(placed).length}/{ITEMS.length} packed</Text>
            <View style={[s.timer, low && s.timerLow, timeUp && s.timerUp]}><Text style={[s.timerText, (low || timeUp) && { color: C.white }]}>{timeUp ? "0:00 · van's here" : fmt(remaining)}</Text></View>
          </View>
          {role === "caretaker" && selected != null && (
            <Text style={s.confirm}>Patient is pointing at: <Text style={{ color: C.care, fontWeight: "800" }}>{vItems[selected].name}</Text> ({POS[selected]}). Confirm it, then name the box.</Text>
          )}
          <ShelfScene role={role} items={vItems} placed={placed} selected={selected} flash={flash} onItem={tapItem} />
          <BoxRow role={role} placed={placed} selected={selected} onBox={tapBox} />
        </View>
      ) : room === "hearing" ? (
        <View style={s.body}>
          <Text style={s.frame}>{role === "caretaker" ? "Show the order without speaking. Point, gesture, count on your fingers." : "Watch your partner. Tap the tiles in the order they show you."}</Text>
          {role === "caretaker" ? (
            <View>
              <Text style={s.section}>YOUR TARGET ORDER</Text>
              <View style={s.seqRow}>
                {hTarget.map((ti, i) => (
                  <View key={i} style={s.seqItem}>
                    <Text style={s.seqNo}>{i + 1}</Text>
                    <View style={[s.tileSm, { backgroundColor: (hTiles[ti] || {}).color || C.muted }]}><TileFace tile={hTiles[ti]} size={rs(44)} /></View>
                  </View>
                ))}
              </View>
              <Text style={[s.section, { marginTop: 18 }]}>PATIENT IS TAPPING</Text>
              <View style={s.seqRow}>
                {Array.from({ length: HSEQ }).map((_, i) => {
                  const ti = hTaps[i]; const good = ti != null && ti === hTarget[i];
                  return <View key={i} style={[s.slotSm, ti != null && { backgroundColor: (hTiles[ti] || {}).color, borderColor: good ? C.ok : C.bad, borderWidth: 3 }]}>{ti != null && <TileFace tile={hTiles[ti]} size={rs(40)} />}</View>;
                })}
              </View>
            </View>
          ) : (
            <View>
              <Text style={s.section}>YOUR PROGRESS</Text>
              <View style={s.seqRow}>
                {Array.from({ length: HSEQ }).map((_, i) => {
                  const ti = hTaps[i];
                  return <View key={i} style={[s.slotSm, ti != null && { backgroundColor: (hTiles[ti] || {}).color }]}>{ti != null && <TileFace tile={hTiles[ti]} size={rs(40)} />}</View>;
                })}
              </View>
              <Text style={[s.section, { marginTop: 18 }]}>TILES</Text>
              <View style={s.tileGrid}>
                {hTiles.map((t, i) => {
                  const used = hTaps.includes(i);
                  return <Pressable key={i} onPress={() => hTap(i)} disabled={hTaps.length >= HSEQ || used} style={[s.tile, { backgroundColor: t.color }, used && { opacity: 0.35 }]}><TileFace tile={t} size={rs(48)} /></Pressable>;
                })}
              </View>
              {hTaps.length > 0 && <Pressable onPress={hClear} style={s.clearBtn}><Text style={s.clearText}>clear my taps</Text></Pressable>}
            </View>
          )}
          {hFlash === "wrong" && <Text style={s.wrongMsg}>Not the right order. Try again.</Text>}
        </View>
      ) : room === "motor" ? (
        <View style={[s.body, { alignItems: "center" }]}>
          <Text style={s.frame}>{role === "caretaker" ? "Only you can see the slots. Tell them where each piece goes, and be patient." : "You cannot see the slots. Follow your caretaker and drag each piece where they say."}</Text>
          <View style={s.progressDots}>{MPIECES.map((_, i) => <View key={i} style={[s.pdot, i < mIndex && { backgroundColor: C.ok }]} />)}</View>
          <View style={[s.phone, { width: PHONE_W, height: PHONE_H }]}>
            {role === "caretaker" && mSlots.map((sl, i) => i >= mIndex ? (
              <View key={"s" + i} style={[s.slotOutline, { left: sl.x, top: sl.y, width: PIECE, height: PIECE }, i === mIndex && s.slotActive]}><Shape type={MPIECES[i].shape} size={PIECE * 0.5} color={i === mIndex ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.22)"} /></View>
            ) : null)}
            {mSlots.length > 0 && MPIECES.map((pc, i) => i < mIndex ? (
              <View key={"p" + i} style={[s.piecePlaced, { left: mSlots[i].x, top: mSlots[i].y, width: PIECE, height: PIECE, backgroundColor: pc.color }]}><Shape type={pc.shape} size={PIECE * 0.5} color="#fff" /></View>
            ) : null)}
            {mIndex < MPIECES.length && (role === "patient" ? (
              <View {...pan.panHandlers} style={[s.pieceActive, { left: mOffset.x, top: mOffset.y, width: PIECE, height: PIECE, backgroundColor: MPIECES[mIndex].color }]}><Shape type={MPIECES[mIndex].shape} size={PIECE * 0.5} color="#fff" /></View>
            ) : (
              <View style={[s.pieceActive, { left: mOffset.x, top: mOffset.y, width: PIECE, height: PIECE, backgroundColor: MPIECES[mIndex].color }]}><Shape type={MPIECES[mIndex].shape} size={PIECE * 0.5} color="#fff" /></View>
            ))}
          </View>
          {mFlash === "miss" && <Text style={s.wrongMsg}>Slipped off. Try again, slower.</Text>}
        </View>
      ) : sFailed ? (
        <View style={s.doneWrap}>
          <Text style={[s.doneTag, { color: C.bad }]}>OUT OF TRIES</Text>
          <Text style={s.doneBig}>{role === "patient" ? `You needed ${needName(sTarget)}.` : "Not this time."}</Text>
          {role === "caretaker" ? (
            <View style={s.ruleBox}><Text style={s.ruleLine}>Tips: start broad, then narrow. Ask about a category first ("is it something to drink?"), offer options instead of guessing at random, and use every Unsure to rule choices out.</Text></View>
          ) : (
            <Text style={s.doneSub}>Wait for your caretaker to start a new round.</Text>
          )}
        </View>
      ) : role === "patient" ? (
        <View style={s.body}>
          <Text style={s.frame}>Answer their questions. You may only use these three replies.</Text>
          <Text style={s.section}>YOU NEED</Text>
          <View style={[s.needCard, { borderColor: (NEEDS.find((n) => n.id === sTarget) || {}).color || C.line }]}>
            <View style={[s.needDot, { backgroundColor: (NEEDS.find((n) => n.id === sTarget) || {}).color }]} />
            <Text style={s.needName}>{needName(sTarget)}</Text>
          </View>
          <Text style={[s.section, { marginTop: 20 }]}>YOUR REPLIES</Text>
          <View style={s.replyRow}>
            {RESPONSES.map((r) => (
              <Pressable key={r.val} onPress={() => sReply(r.val)} style={[s.reply, { backgroundColor: r.color }, sAnswer === r.val && s.replyActive]}><Text style={s.replyText}>{r.label}</Text></Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={s.body}>
          <Text style={s.frame}>Ask yes or no questions aloud. Read their reply, then tap your guess.</Text>
          <Text style={s.section}>THEIR LAST REPLY</Text>
          <View style={[s.answerBox, sAnswer && { backgroundColor: (RESPONSES.find((r) => r.val === sAnswer) || {}).color }]}><Text style={[s.answerText, sAnswer && { color: C.white }]}>{sAnswer ? (RESPONSES.find((r) => r.val === sAnswer) || {}).label : "waiting…"}</Text></View>
          <Text style={[s.section, { marginTop: 16 }]}>GUESS WHAT THEY NEED</Text>
          <View style={s.needGrid}>
            {NEEDS.map((n) => (
              <Pressable key={n.id} onPress={() => sGuess(n.id)} style={[s.needBtn, { borderColor: n.color }]}><View style={[s.needDot, { backgroundColor: n.color }]} /><Text style={s.needBtnText}>{n.name}</Text></Pressable>
            ))}
          </View>
          <Text style={[s.tries, (3 - sWrong) <= 1 && { color: C.bad }]}>{`${Math.max(0, 3 - sWrong)} ${3 - sWrong === 1 ? "try" : "tries"} left`}</Text>
          {sFlash === "wrong" && <Text style={s.triesNote}>Not that one. Keep asking.</Text>}
        </View>
      )}

      <View style={s.footer}>
        {role === "caretaker" ? (
          sFailed ? (
            <Pressable style={[s.primary, { backgroundColor: C.ink }]} onPress={startRound}><Text style={s.primaryText}>Try again</Text></Pressable>
          ) : (started || won) ? (
            <Pressable style={[s.primary, { backgroundColor: C.ink }]} onPress={newRound}><Text style={s.primaryText}>{won ? "Play again" : "Reset round"}</Text></Pressable>
          ) : (
            <Text style={s.hint}>{startHint}</Text>
          )
        ) : (
          <Text style={s.hint}>{patientHint}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create(scaleStyles({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 26, flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },

  // role select
  roleHead: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  kicker: { fontFamily: MONO, fontSize: 12, letterSpacing: 3, color: C.muted },
  roleTitle: { fontSize: 32, fontWeight: "800", color: C.ink, marginTop: 26, letterSpacing: -0.5 },
  roleSub: { fontSize: 15, color: C.muted, marginTop: 2 },
  rolePanel: { marginHorizontal: 24, marginTop: 14, borderRadius: 16, paddingVertical: 20, alignItems: "center", justifyContent: "center" },
  roleName: { fontSize: 24, fontWeight: "800", color: C.white, letterSpacing: -0.3 },

  // scenario select
  selHead: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10 },
  back: { fontFamily: MONO, fontSize: 13, color: C.muted },
  selTitle: { fontSize: 28, fontWeight: "800", color: C.ink, marginTop: 12, letterSpacing: -0.4 },
  selSub: { fontSize: 14, color: C.muted, marginTop: 4, lineHeight: 19 },
  scCard: { flexDirection: "row", alignItems: "center", backgroundColor: C.panel, borderRadius: 14, padding: 16, marginTop: 12, borderWidth: 1, borderColor: C.line, gap: 14 },
  scCardOff: { opacity: 0.55 },
  scIndex: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  scIndexText: { color: C.white, fontFamily: MONO, fontSize: 15, fontWeight: "800" },
  scName: { fontSize: 18, fontWeight: "800", color: C.ink },
  scTag: { fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 18 },
  scState: { fontFamily: MONO, fontSize: 13, fontWeight: "700" },

  // top bar  ── sizing: barScenario = main centre text; backSmall = back arrow; barStatus = status text; chipSm = role pill
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  barBack: { width: 30, justifyContent: "center", alignItems: "flex-start" },
  backSmall: { fontSize: 26, color: C.muted, fontWeight: "700" },
  barCenter: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
  barScenario: { fontSize: 18, fontWeight: "800", color: C.ink, letterSpacing: -0.2, textAlign: "center" },
  chipSm: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 3 },
  chipSmText: { color: C.white, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  barStatusWrap: { width: 90, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  chipText: { color: C.white, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  barStatus: { fontFamily: MONO, fontSize: 11, color: C.muted, flexShrink: 1 },

  // shared game text
  frame: { fontSize: 13, color: C.muted, marginTop: 6, marginBottom: 4, lineHeight: 18 },
  headline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  section: { fontFamily: MONO, fontSize: 11, letterSpacing: 2.2, color: C.muted, marginTop: 4 },
  count: { fontFamily: MONO, fontSize: 14, color: C.ink, fontWeight: "700" },
  timer: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 5, minWidth: 78, alignItems: "center" },
  timerLow: { backgroundColor: "#C98A2F", borderColor: "#C98A2F" },
  timerUp: { backgroundColor: C.bad, borderColor: C.bad },
  timerText: { fontFamily: MONO, fontSize: 16, fontWeight: "800", color: C.ink },
  confirm: { fontSize: 13, color: C.ink, backgroundColor: "#EAF1EE", borderRadius: 10, padding: 10, marginTop: 10, lineHeight: 18 },

  // vision shelf
  shelfUnit: { marginTop: 16 },
  shelfRow: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end", minHeight: 92 },
  slotTap: { width: "30%", alignItems: "center" },
  slot: { width: "100%", aspectRatio: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  slotDone: { backgroundColor: "#E7EFE7", borderWidth: 1, borderColor: C.ok },
  slotDoneMark: { color: C.ok, fontSize: 26, fontWeight: "800" },
  imgWrap: { width: "92%", height: "92%", alignItems: "center", justifyContent: "center" },
  img: { width: "100%", height: "100%" },
  dim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(120,118,112,0.22)", borderRadius: 8 },
  ph: { width: "84%", height: "84%", borderRadius: 10, alignItems: "center", justifyContent: "center" },
  phLetter: { color: "rgba(255,255,255,0.9)", fontSize: 26, fontWeight: "800" },
  itemName: { fontSize: 12, fontWeight: "700", color: C.ink, marginTop: 4 },
  miniTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginTop: 3 },
  miniTagText: { color: C.white, fontSize: 10, fontWeight: "700" },
  plank: { height: 12, backgroundColor: C.wood, borderRadius: 3, marginTop: 2 },
  plankEdge: { height: 4, backgroundColor: C.woodEdge, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, marginHorizontal: 6 },
  boxRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  box: { width: "31%", borderRadius: 12, borderWidth: 2, backgroundColor: C.panel, paddingBottom: 12, alignItems: "center", overflow: "hidden" },
  boxActive: { backgroundColor: "#FFFDF6" },
  boxLip: { height: 10, width: "100%" },
  boxName: { fontSize: 14, fontWeight: "800", color: C.ink, marginTop: 12 },
  boxCount: { fontFamily: MONO, fontSize: 20, color: C.muted, marginTop: 2 },

  // done / full
  doneWrap: { flex: 1, alignItems: "flex-start", justifyContent: "center", paddingHorizontal: 26 },
  doneTag: { fontFamily: MONO, fontSize: 12, letterSpacing: 3, fontWeight: "700" },
  doneBig: { fontSize: 34, fontWeight: "800", color: C.ink, marginTop: 8, letterSpacing: -0.5, lineHeight: 40 },
  doneSub: { fontSize: 16, color: C.muted, marginTop: 8, lineHeight: 22, maxWidth: 320 },
  fullWrap: { flex: 1, alignItems: "flex-start", justifyContent: "center", paddingHorizontal: 26 },
  fullBig: { fontSize: 26, fontWeight: "800", color: C.ink, marginTop: 8, letterSpacing: -0.3, lineHeight: 32 },
  fullSub: { fontSize: 15, color: C.muted, marginTop: 10, lineHeight: 21, maxWidth: 320 },

  // intro
  startWrap: { paddingHorizontal: 12, paddingTop: 8 },
  startKicker: { fontFamily: MONO, fontSize: 12, letterSpacing: 3, color: C.muted, fontWeight: "700" },
  startBig: { fontSize: 30, fontWeight: "800", color: C.ink, marginTop: 8, letterSpacing: -0.5, lineHeight: 36 },
  startSub: { fontSize: 15, color: C.ink, marginTop: 12, lineHeight: 22 },
  startWait: { fontFamily: MONO, fontSize: 13, color: C.ink, marginTop: 20 },
  ruleBox: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginTop: 14 },
  ruleLine: { fontSize: 14, color: C.ink, lineHeight: 20 },

  // buttons / footer
  primary: { borderRadius: 12, paddingVertical: 16, alignItems: "center", alignSelf: "stretch" },
  primaryOff: { backgroundColor: "#C8C2B6" },
  primaryText: { color: C.white, fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
  footer: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line },
  hint: { fontFamily: MONO, fontSize: 13, color: C.ink, textAlign: "center" },

  // hearing
  seqRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  seqItem: { alignItems: "center" },
  seqNo: { fontFamily: MONO, fontSize: 12, color: C.muted, marginBottom: 4 },
  tileSm: { width: 52, height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  slotSm: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 },
  tile: { width: "31%", aspectRatio: 1.05, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  clearBtn: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel },
  clearText: { fontFamily: MONO, fontSize: 13, color: C.ink },
  wrongMsg: { color: C.bad, fontSize: 13, marginTop: 12, fontFamily: MONO, textAlign: "center" },
  tries: { fontFamily: MONO, fontSize: 15, fontWeight: "700", color: C.ink, marginTop: 18 },
  triesNote: { fontFamily: MONO, fontSize: 13, color: C.bad, marginTop: 6 },

  // motor
  progressDots: { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 12 },
  pdot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.line },
  phone: { backgroundColor: C.phone, borderRadius: 26, alignSelf: "center", position: "relative", borderWidth: 6, borderColor: "#1C1F23", overflow: "hidden" },
  slotOutline: { position: "absolute", borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  slotActive: { borderColor: C.pick, borderStyle: "solid", borderWidth: 3 },
  piecePlaced: { position: "absolute", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pieceActive: { position: "absolute", borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.6)" },

  // speech
  needCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.panel, borderRadius: 14, borderWidth: 2, padding: 18, marginTop: 10 },
  needDot: { width: 22, height: 22, borderRadius: 11 },
  needName: { fontSize: 26, fontWeight: "800", color: C.ink },
  replyRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  reply: { width: "31%", paddingVertical: 22, borderRadius: 14, alignItems: "center" },
  replyActive: { borderWidth: 3, borderColor: C.ink },
  replyText: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  answerBox: { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 20, alignItems: "center", marginTop: 8 },
  answerText: { fontSize: 22, fontWeight: "800", color: C.muted },
  needGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 8 },
  needBtn: { width: "48%", flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.panel, borderRadius: 12, borderWidth: 2, padding: 14, marginBottom: 12 },
  needBtnText: { fontSize: 16, fontWeight: "700", color: C.ink },
}));