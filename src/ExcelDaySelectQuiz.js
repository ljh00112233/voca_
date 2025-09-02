import React, { useMemo, useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// ===== utils =====
const split = (s = "") => s.split(/[\/,;|]/g).map(v => v.trim()).filter(Boolean);
const normKo = (s = "") => s.replace(/\s+/g, " ").trim().replace(/[.,!?(){}[\]'“”‘’"]/g, "");
const normEn = (s = "") => s.replace(/\s+/g, " ").trim().toLowerCase();
function formatDayKey(v){ if(v==null) return ""; const val=String(v).trim(); if(!isNaN(v)&&val!=="") return val; return val; }
const joinPOS = (r) => {
  const parts = [];
  if (r.noun?.length) parts.push(`(명) ${r.noun.join(" / ")}`);
  if (r.verb?.length) parts.push(`(동) ${r.verb.join(" / ")}`);
  if (r.adj ?.length) parts.push(`(형) ${r.adj.join(" / ")}`);
  return parts.join(" · ");
};

// 뜻 문자열에서 (명)/(동)/(형) 패턴을 최대한 파싱 (가져온 오답 엑셀에 품사 정보가 합쳐져 있을 때)
function parseMeaningToPOS(meaningText = "") {
  const noun = [];
  const verb = [];
  const adj  = [];
  const txt = meaningText.replace(/\s+/g, " ").trim();

  // (명) ..., (동) ..., (형) ... 패턴
  const re = /\((명|동|형)\)\s*([^()·]+)/g;
  let m;
  let matchedAny = false;
  while ((m = re.exec(txt))) {
    matchedAny = true;
    const label = m[1];
    const body  = m[2] || "";
    const items = split(body);
    if (label === "명") noun.push(...items);
    if (label === "동") verb.push(...items);
    if (label === "형") adj .push(...items);
  }
  if (!matchedAny && txt) {
    // 품사 구분이 없으면 명사 칸으로 몰아 넣기(최소 동작 보장)
    noun.push(...split(txt));
  }
  return { noun, verb, adj };
}

// ===== main component =====
export default function ExcelDaySelectQuiz(){
  // 데이터/선택
  const [rows,setRows] = useState([]);
  const [dayKeys,setDayKeys] = useState([]);
  const [checkedDays,setCheckedDays] = useState({});

  // 모드/문제 상태
  const [mode,setMode] = useState("en2ko"); // 'en2ko' 영어→한글(품사별), 'ko2en' 한글→영어
  const [questions,setQuestions] = useState([]);
  const [idx,setIdx] = useState(0);
  const [revealed,setRevealed] = useState(false);
  const [score,setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  // 입력값
  const [inputsPOS,setInputsPOS] = useState({noun:"",verb:"",adj:""}); // en2ko용
  const [inputEN,setInputEN] = useState("");                            // ko2en용

  // 기록 테이블
  const [history, setHistory] = useState([]); // [{no, word, meaningText, myInput, correct, rec}...]

  // 단어 보기 (검색/필터)
  const [showWords, setShowWords] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [posFilter, setPosFilter] = useState({ noun:false, verb:false, adj:false });

  // 오답 노트 (localStorage)
  const LS_KEY = "voca_wrong_bank_v1";
  const [wrongBank, setWrongBank] = useState([]); // [{id, word, dayKey, meaningText, addedAt, seen, wrong}]
  const [showWrongBank, setShowWrongBank] = useState(false);

  // 포커스 관리용 ref들
  const containerRef = useRef(null);
  const nounRef = useRef(null);
  const verbRef = useRef(null);
  const adjRef  = useRef(null);
  const enRef   = useRef(null);

  // 오답 엑셀 import용 input ref
  const wrongImportRef = useRef(null);

  // ===== 엑셀 업로드 =====
  const onFile = async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type:"array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval:"" });

    const mapped = json.map(r=>{
      const o={}; for(const k of Object.keys(r)) o[k.trim().toLowerCase()] = r[k];
      const dayRaw = o["날짜"]||o["day"]||"";
      const word   = o["단어"]||o["word"]||"";
      const noun   = o["명사"]||"";
      const verb   = o["동사"]||"";
      const adj    = o["형용사"]||"";
      return {
        dayKey: formatDayKey(dayRaw),
        word: String(word).trim(),
        noun: split(String(noun||"")),
        verb: split(String(verb||"")),
        adj : split(String(adj ||"")),
      };
    }).filter(r=>r.word && r.dayKey);

    const unique = Array.from(new Set(mapped.map(r=>r.dayKey))).sort((a,b)=>{
      const na=Number(a), nb=Number(b);
      if(!isNaN(na)&&!isNaN(nb)) return na-nb;
      return String(a).localeCompare(String(b));
    });

    setRows(mapped);
    setDayKeys(unique);
    const init={}; unique.forEach(k=>init[k]=false);
    setCheckedDays(init);

    // 초기화
    resetAll(false);
  };

  // ===== 공통 리셋 =====
  const resetAll = (alsoShuffle = true) => {
    setQuestions(prev => (alsoShuffle ? [...prev].sort(()=>Math.random()-0.5) : []));
    setIdx(0);
    setScore(0);
    setRevealed(false);
    setFinished(false);
    setInputsPOS({noun:"",verb:"",adj:""});
    setInputEN("");
    setHistory([]);
    containerRef.current?.focus();
  };

  // 날짜 체크
  const toggleDay = (k)=> setCheckedDays(prev=>({ ...prev, [k]: !prev[k] }));

  // 문제 생성(선택 날짜)
  const buildQuestions = ()=>{
    const pickDays = Object.entries(checkedDays).filter(([,v])=>v).map(([k])=>k);
    if(!pickDays.length){ alert("최소 1개 이상의 날짜를 선택하세요."); return; }
    const picked = rows.filter(r=>pickDays.includes(r.dayKey));
    const qs = picked.map(r=>({ word:r.word, noun:r.noun, verb:r.verb, adj:r.adj, dayKey:r.dayKey }));
    const shuffled = [...qs].sort(()=>Math.random()-0.5);

    setQuestions(shuffled);
    setIdx(0); setScore(0); setRevealed(false); setFinished(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
    setHistory([]);
    containerRef.current?.focus();
    requestAnimationFrame(() => focusFirstInput(false));
  };

  // ===== 오답 노트 (localStorage) =====
  const loadWrongBank = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };
  const persistWrongBank = (updater) => {
    // updater는 배열 또는 prev=>new 형태
    setWrongBank(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  useEffect(() => {
    const boot = loadWrongBank();
    setWrongBank(boot);
  }, []);

  const wrongId = (rec) => `${rec.dayKey}__${String(rec.word || "").toLowerCase()}`;
  const saveWrong = (rec) => {
    const id = wrongId(rec);
    const now = Date.now();
    persistWrongBank(prev => {
      const cur = Array.isArray(prev) ? [...prev] : [];
      const idx = cur.findIndex(x => x.id === id);
      const base = {
        id,
        word: rec.word,
        dayKey: rec.dayKey,
        meaningText: joinPOS(rec),
        addedAt: now,
        seen: 0,
        wrong: 1,
      };
      if (idx === -1) cur.push(base);
      else cur[idx] = { ...cur[idx], meaningText: base.meaningText, wrong: (cur[idx].wrong||0) + 1 };
      return cur;
    });
  };
  const removeWrong = (id) => persistWrongBank(prev => prev.filter(x => x.id !== id));
  const clearWrongBank = () => {
    if (!window.confirm("오답 노트를 모두 비울까요?")) return;
    persistWrongBank([]);
  };

  const startQuizFromWrongBank = () => {
    if (!wrongBank.length) { alert("오답 노트가 비어 있습니다."); return; }
    const qs = wrongBank.map(x => {
      const found = rows.find(r => r.word === x.word && String(r.dayKey) === String(x.dayKey));
      if (found) return { ...found };
      // rows에 없으면 meaningText를 분해해서 최대한 복원
      const { noun, verb, adj } = parseMeaningToPOS(x.meaningText);
      return { word: x.word, dayKey: x.dayKey, noun, verb, adj };
    });
    const shuffled = [...qs].sort(()=>Math.random()-0.5);
    setQuestions(shuffled);
    setIdx(0); setScore(0); setRevealed(false); setFinished(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
    setHistory([]);
    requestAnimationFrame(() => focusFirstInput(false));
  };

  // ===== 오답: 엑셀 내보내기 / 불러오기 =====
// 맨 위에 이미 있음:
// import * as XLSX from "xlsx";
// import { saveAs } from "file-saver";

const exportWrongBankToExcel = () => {
    if (!wrongBank.length) {
      alert("저장할 오답이 없습니다.");
      return;
    }

    // 1) 한국시간(KST) 기준 오늘 날짜 문자열 만들기 -> YYYYMMDD
    const parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const yyyy = parts.find(p => p.type === "year")?.value ?? "0000";
    const mm   = parts.find(p => p.type === "month")?.value ?? "00";
    const dd   = parts.find(p => p.type === "day")?.value ?? "00";
    const todayStr = `${yyyy}${mm}${dd}`; // 예: 20250902

    // 2) 엑셀에 넣을 데이터 가공
    const data = wrongBank.map((w, i) => ({
      번호: i + 1,
      날짜: w.dayKey,
      단어: w.word,
      뜻: w.meaningText,
      "본 횟수": w.seen || 0,
      "오답 수": w.wrong || 1,
      추가일시: w.addedAt ? new Date(w.addedAt).toLocaleString() : "",
    }));

    // 3) 워크시트/워크북 생성 및 저장
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "오답노트");
    const wbout = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    // ✅ 파일명에 오늘 날짜 포함
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), `오답노트_${todayStr}.xlsx`);
  };


  // 엑셀에서 오답 불러와서: 1) 오답 노트로 저장 + 2) 바로 오답 라운드 시작
  const importWrongBankFromExcel = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval:"" });

      // 컬럼: 날짜/단어/뜻 (번호/본 횟수/오답 수/추가일시 있으면 무시해도 ok)
      const imported = [];
      for (const row of json) {
        // 헤더 다양성 대응
        const norm = {};
        for (const k of Object.keys(row)) norm[k.trim().toLowerCase()] = row[k];

        const dayKey = formatDayKey(norm["날짜"] ?? norm["day"] ?? norm["일차"] ?? "");
        const word   = (norm["단어"] ?? norm["word"] ?? "").toString().trim();
        const meaningText = (norm["뜻"] ?? norm["의미"] ?? norm["meaning"] ?? "").toString().trim();

        if (!word) continue; // 단어는 필수
        imported.push({ dayKey: dayKey || "-", word, meaningText });
      }

      if (!imported.length) {
        alert("가져올 오답이 없습니다. (엑셀에 날짜/단어/뜻 컬럼 확인)");
        // input 값 초기화
        e.target.value = "";
        return;
      }

      // 1) 오답 노트에 병합 저장
      persistWrongBank(prev => {
        const cur = Array.isArray(prev) ? [...prev] : [];
        const now = Date.now();
        for (const it of imported) {
          const id = `${it.dayKey}__${it.word.toLowerCase()}`;
          const idx = cur.findIndex(x => x.id === id);
          const base = {
            id,
            word: it.word,
            dayKey: it.dayKey,
            meaningText: it.meaningText,
            addedAt: now,
            seen: 0,
            wrong: 1,
          };
          if (idx === -1) cur.push(base);
          else cur[idx] = { ...cur[idx], meaningText: base.meaningText, wrong: (cur[idx].wrong||0) + 1 };
        }
        return cur;
      });

      // 2) 즉시 오답 라운드 시작
      const qs = imported.map(x => {
        const found = rows.find(r => r.word === x.word && String(r.dayKey) === String(x.dayKey));
        if (found) return { ...found };
        const { noun, verb, adj } = parseMeaningToPOS(x.meaningText);
        return { word: x.word, dayKey: x.dayKey, noun, verb, adj };
      });
      const shuffled = [...qs].sort(()=>Math.random()-0.5);
      setQuestions(shuffled);
      setIdx(0); setScore(0); setRevealed(false); setFinished(false);
      setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
      setHistory([]);
      requestAnimationFrame(() => focusFirstInput(false));
    } catch (err) {
      console.error(err);
      alert("오답 엑셀을 불러오는 중 오류가 발생했습니다.");
    } finally {
      // 같은 파일 다시 선택할 수 있도록 초기화
      e.target.value = "";
    }
  };

  // ===== 현재 문제 품사 =====
  const cur = questions[idx];
  const presentPOS = useMemo(()=>{
    if(!cur) return [];
    const arr=[]; if(cur.noun?.length) arr.push("noun");
    if(cur.verb?.length) arr.push("verb");
    if(cur.adj ?.length) arr.push("adj");
    return arr;
  },[cur]);

  // ko2en 프롬프트
  const koPrompt = useMemo(()=>{
    if(!cur) return "";
    return joinPOS(cur);
  },[cur]);

  // 채점
  const check = ()=>{
    if(!cur) return;
    let ok=false;
    let myInputText="";
    if(mode==="en2ko"){
      ok = presentPOS.every(pos=>{
        const user = normKo(inputsPOS[pos]||"");
        const targets = (cur[pos]||[]).map(normKo);
        if (pos==="noun") myInputText += (myInputText? " · ":"") + `명:${inputsPOS.noun||"-"}`;
        if (pos==="verb") myInputText += (myInputText? " · ":"") + `동:${inputsPOS.verb||"-"}`;
        if (pos==="adj")  myInputText += (myInputText? " · ":"") + `형:${inputsPOS.adj ||"-"}`;
        return user && targets.includes(user);
      });
    }else{
      ok = normEn(inputEN) === normEn(cur.word);
      myInputText = inputEN || "-";
    }
    if(ok) setScore(s=>s+1);
    setRevealed(true);

    // 기록 추가(원본 레코드 포함)
    setHistory(h => ([
      ...h,
      {
        no: h.length + 1,
        word: cur.word,
        meaningText: joinPOS(cur),
        myInput: myInputText,
        correct: ok,
        rec: { ...cur }
      }
    ]));

    // ✅ 오답을 오답노트에 저장
    if (!ok) saveWrong(cur);
    // (원하면 정답이면 오답노트에서 제거: if (ok) removeWrong(wrongId(cur)); )
  };

  // 다음
  const next = ()=>{
    if(idx+1 >= questions.length){
      // 완료 화면 전환
      setFinished(true);
      setQuestions([]); // 카드 숨기기
      setIdx(0);
      setRevealed(false);
      return;
    }
    setIdx(idx+1); setRevealed(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
    requestAnimationFrame(() => focusFirstInput(false));
  };

  // 첫 입력칸 포커스
  const focusFirstInput = (isRevealed = revealed)=>{
    if(isRevealed) return;
    if(mode==="en2ko"){
      if(nounRef.current){ nounRef.current.focus(); return; }
      if(verbRef.current){ verbRef.current.focus(); return; }
      if(adjRef.current ){ adjRef.current.focus();  return; }
    }else{
      if(enRef.current){ enRef.current.focus(); return; }
    }
  };

  // 전역 Enter(제출/다음) - 완료 화면에선 동작 X
  useEffect(()=>{
    const handler = (e)=>{
      if(e.key !== "Enter") return;
      if (finished) return;
      e.preventDefault();
      if(questions.length === 0) return;
      if(!revealed) check(); else next();
    };
    window.addEventListener("keydown", handler);
    return ()=> window.removeEventListener("keydown", handler);
  }, [questions.length, revealed, idx, mode, inputsPOS, inputEN, finished]);

  // 포커싱
  useEffect(()=>{
    const id = requestAnimationFrame(()=>focusFirstInput());
    return ()=> cancelAnimationFrame(id);
  }, [idx, mode, revealed]);

  // 모드 바뀌면 입력 초기화
  useEffect(()=>{
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN(""); setRevealed(false);
  },[mode]);

  // 선택한 날짜의 단어 목록(미리보기) + 검색/품사 필터
  const selectedWordList = useMemo(()=>{
    const pickDays = Object.entries(checkedDays).filter(([,v])=>v).map(([k])=>k);
    let picked = rows.filter(r=>pickDays.includes(r.dayKey));

    // 품사 필터
    const anyPOS = posFilter.noun || posFilter.verb || posFilter.adj;
    if (anyPOS) {
      picked = picked.filter(r => {
        if (posFilter.noun && !(r.noun?.length)) return false;
        if (posFilter.verb && !(r.verb?.length)) return false;
        if (posFilter.adj  && !(r.adj ?.length)) return false;
        return true;
      });
    }

    // 검색(단어/뜻)
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      picked = picked.filter(r => {
        const wordHit = r.word.toLowerCase().includes(q);
        const meaningHit = joinPOS(r).toLowerCase().includes(q);
        return wordHit || meaningHit;
      });
    }

    // 정렬
    return picked.sort((a,b)=>{
      if(a.dayKey===b.dayKey) return a.word.localeCompare(b.word);
      const na=Number(a.dayKey), nb=Number(b.dayKey);
      if(!isNaN(na)&&!isNaN(nb)) return na-nb;
      return String(a.dayKey).localeCompare(String(b.dayKey));
    });
  }, [rows, checkedDays, searchTerm, posFilter]);

  return (
    <div
      ref={containerRef}
      style={{ maxWidth: 1000, margin:"2rem auto", padding:"0 1rem" }}
      tabIndex={-1}
    >
      <h1 style={{ textAlign:"center", marginBottom:"1rem" }}>
        엑셀 단어 학습 (날짜 선택형)
      </h1>

      <input type="file" accept=".xlsx,.xls" onChange={onFile} />

      {dayKeys.length>0 && (
        <div style={{ marginTop:16, padding:12, border:"1px solid #ddd", borderRadius:12 }}>
          <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ fontWeight:600 }}>날짜 선택:</div>
            {dayKeys.map(k=>{
              const count = rows.filter(r=>r.dayKey===k).length;
              return (
                <label key={k} style={{ display:"flex", gap:6 }}>
                  <input
                    type="checkbox"
                    checked={!!checkedDays[k]}
                    onChange={()=>setCheckedDays(p=>({...p, [k]: !p[k]}))}
                  />
                  <span>{k} <span style={{ opacity:0.6 }}>({count}개)</span></span>
                </label>
              );
            })}
            <div style={{ marginLeft:"auto", display:"flex", gap:8, flexWrap:"wrap" }}>
              <button
                onClick={()=>setMode("en2ko")}
                style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc",
                         background: mode==="en2ko" ? "#f0f0f0" : "transparent" }}
              >
                단어풀기 (영→한)
              </button>
              <button
                onClick={()=>setMode("ko2en")}
                style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc",
                         background: mode==="ko2en" ? "#f0f0f0" : "transparent" }}
              >
                뜻풀기 (한→영)
              </button>
              <button
                onClick={buildQuestions}
                style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
              >
                선택한 날짜로 시작
              </button>
              <button
                onClick={()=>setShowWords(s=>!s)}
                style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
              >
                {showWords ? "단어 보기 닫기" : "단어 보기"}
              </button>
            </div>
          </div>

          {/* 단어 보기 표 + 검색/필터 */}
          {showWords && (
            <div style={{ marginTop:12 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
                <input
                  value={searchTerm}
                  onChange={e=>setSearchTerm(e.target.value)}
                  placeholder="단어 또는 뜻 검색..."
                  style={{ padding:"8px 10px", border:"1px solid #ccc", borderRadius:8, minWidth:220 }}
                />
                <label><input type="checkbox" checked={posFilter.noun} onChange={()=>setPosFilter(p=>({...p, noun:!p.noun}))}/> 명</label>
                <label><input type="checkbox" checked={posFilter.verb} onChange={()=>setPosFilter(p=>({...p, verb:!p.verb}))}/> 동</label>
                <label><input type="checkbox" checked={posFilter.adj } onChange={()=>setPosFilter (p=>({...p, adj :!p.adj }))}/> 형</label>
                {(posFilter.noun||posFilter.verb||posFilter.adj||searchTerm) && (
                  <button onClick={()=>{ setPosFilter({noun:false,verb:false,adj:false}); setSearchTerm(""); }}
                          style={{ marginLeft:"auto", padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}>
                    필터 초기화
                  </button>
                )}
              </div>

              <div style={{ maxHeight: 300, overflow:"auto", border:"1px solid #eee", borderRadius:8 }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14 }}>
                  <thead>
                    <tr style={{ background:"#fafafa" }}>
                      <th style={th}>날짜</th>
                      <th style={th}>단어</th>
                      <th style={th}>뜻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWordList.map((r, i)=>(
                      <tr key={`${r.dayKey}-${r.word}-${i}`}>
                        <td style={td}>{r.dayKey}</td>
                        <td style={td}>{r.word}</td>
                        <td style={td}>{joinPOS(r)}</td>
                      </tr>
                    ))}
                    {selectedWordList.length===0 && (
                      <tr><td colSpan={3} style={{ ...td, textAlign:"center", opacity:0.7 }}>표시할 항목이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 문제 카드 (진행 중에만 표시) */}
      {(!finished && cur) && (
        <div style={{ marginTop:20, border:"1px solid #eee", borderRadius:12, padding:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
            <div>문제 {idx+1} / {questions.length} ({cur.dayKey})</div>
            <div>점수 {score}</div>
          </div>

          {mode==="en2ko" ? (
            <>
              <h2 style={{ margin:"10px 0" }}>{cur.word}</h2>
              <div style={{ display:"grid", gap:10, gridTemplateColumns:"repeat(auto-fit, minmax(220px,1fr))" }}>
                {presentPOS.includes("noun") && (
                  <div>
                    <div style={{ fontWeight:600 }}>명(뜻)</div>
                    <input
                      ref={nounRef}
                      value={inputsPOS.noun}
                      onChange={e=>setInputsPOS(s=>({...s, noun:e.target.value}))}
                      placeholder="예: 존경/면"
                      disabled={revealed}
                      style={inputStyle}
                    />
                  </div>
                )}
                {presentPOS.includes("verb") && (
                  <div>
                    <div style={{ fontWeight:600 }}>동(뜻)</div>
                    <input
                      ref={verbRef}
                      value={inputsPOS.verb}
                      onChange={e=>setInputsPOS(s=>({...s, verb:e.target.value}))}
                      placeholder="예: 존경하다"
                      disabled={revealed}
                      style={inputStyle}
                    />
                  </div>
                )}
                {presentPOS.includes("adj") && (
                  <div>
                    <div style={{ fontWeight:600 }}>형(뜻)</div>
                    <input
                      ref={adjRef}
                      value={inputsPOS.adj}
                      onChange={e=>setInputsPOS(s=>({...s, adj:e.target.value}))}
                      placeholder="예: 밝은/가벼운"
                      disabled={revealed}
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize:14, opacity:0.8 }}>아래 뜻에 맞는 영어 단어를 입력하세요:</div>
              <h2 style={{ margin:"10px 0" }}>{koPrompt}</h2>
              <input
                ref={enRef}
                value={inputEN}
                onChange={e=>setInputEN(e.target.value)}
                placeholder="영어 단어 입력"
                disabled={revealed}
                style={inputStyle}
              />
            </>
          )}

          {revealed && (
            <div style={{ marginTop:12, padding:12, background:"rgba(0,0,0,0.04)", borderRadius:8 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>정답</div>
              {mode==="en2ko" ? (
                <>
                  {cur.noun.length>0 && <div>명: {cur.noun.join(" / ")}</div>}
                  {cur.verb.length>0 && <div>동: {cur.verb.join(" / ")}</div>}
                  {cur.adj .length>0 && <div>형: {cur.adj .join(" / ")}</div>}
                </>
              ) : (
                <div>{cur.word}</div>
              )}
            </div>
          )}

          {/* 모바일 편의: 제출/다음 버튼 */}
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={check} disabled={revealed} style={primaryBtn}>제출</button>
            <button onClick={next} disabled={!revealed} style={secondaryBtn}>다음</button>
          </div>
        </div>
      )}

      {/* 풀이 기록 */}
      {history.length > 0 && (
        <div style={{ marginTop:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:8, flexWrap:"wrap" }}>
            <h3 style={{ margin:0 }}>
              풀이 기록{finished ? " (라운드 완료)" : ""}
            </h3>

            {/* 완료 후에만 버튼 노출 */}
            {finished && (
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button onClick={startQuizFromWrongBank} style={primaryBtn}>오답 노트로 다시 풀기</button>
                <button onClick={()=>resetAll(false)} style={secondaryBtn}>다시 풀기(초기화)</button>
              </div>
            )}
          </div>

          <div style={{ border:"1px solid #eee", borderRadius:8, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14 }}>
              <thead>
                <tr style={{ background:"#fafafa" }}>
                  <th style={th}>#</th>
                  <th style={th}>단어</th>
                  <th style={th}>뜻</th>
                  <th style={th}>내 입력</th>
                  <th style={th}>정답</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h)=>(
                  <tr key={h.no}>
                    <td style={td}>{h.no}</td>
                    <td style={td}>{h.word}</td>
                    <td style={td}>{h.meaningText}</td>
                    <td style={td}>{h.myInput}</td>
                    <td style={{ ...td, color: h.correct ? "green" : "crimson", fontWeight:600 }}>
                      {h.correct ? "O" : "X"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 오답 노트 */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <h3 style={{ margin:0 }}>오답 노트 <span style={{ opacity:0.6, fontWeight:400 }}>({wrongBank.length}개)</span></h3>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button onClick={() => setShowWrongBank(s=>!s)} style={ghostBtn}>
              {showWrongBank ? "오답 노트 닫기" : "오답 노트 보기"}
            </button>
            <button onClick={startQuizFromWrongBank} style={primaryBtn}>오답 노트로 다시 풀기</button>
            <button onClick={exportWrongBankToExcel} style={secondaryBtn}>오답 엑셀로 저장</button>

            {/* 엑셀 불러오기: 숨은 input 트리거 */}
            <input
              ref={wrongImportRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display:"none" }}
              onChange={importWrongBankFromExcel}
            />
            <button
              onClick={()=> wrongImportRef.current?.click()}
              style={secondaryBtn}
            >
              오답 엑셀 불러와서 풀기
            </button>

            <button onClick={clearWrongBank} style={secondaryBtn}>오답 노트 비우기</button>
          </div>
        </div>

        {showWrongBank && (
          <div style={{ marginTop:8, border:"1px solid #eee", borderRadius:8, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14 }}>
              <thead>
                <tr style={{ background:"#fafafa" }}>
                  <th style={th}>날짜</th>
                  <th style={th}>단어</th>
                  <th style={th}>뜻</th>
                  <th style={th}>본 횟수</th>
                  <th style={th}>오답 수</th>
                  <th style={th}>관리</th>
                </tr>
              </thead>
              <tbody>
                {wrongBank.map((w)=>(
                  <tr key={w.id}>
                    <td style={td}>{w.dayKey}</td>
                    <td style={td}>{w.word}</td>
                    <td style={td}>{w.meaningText}</td>
                    <td style={td}>{w.seen || 0}</td>
                    <td style={td}>{w.wrong || 1}</td>
                    <td style={td}>
                      <button onClick={()=>removeWrong(w.id)} style={{ ...secondaryBtn, padding:"6px 10px" }}>
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {wrongBank.length === 0 && (
                  <tr><td colSpan={6} style={{ ...td, textAlign:"center", opacity:0.7 }}>오답 노트가 비어 있습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== 작은 스타일 헬퍼 ===== */
const inputStyle = {
  width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #ccc"
};
const th = { padding:"10px", borderBottom:"1px solid #eee", textAlign:"left" };
const td = { padding:"10px", borderBottom:"1px solid #f3f3f3", verticalAlign:"top" };

const primaryBtn = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#111",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const secondaryBtn = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#f5f5f5",
  color: "#111",
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "transparent",
  color: "#111",
  cursor: "pointer",
};
