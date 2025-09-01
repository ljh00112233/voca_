import React, { useMemo, useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

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
  const [finished, setFinished] = useState(false); // ✅ 라운드 완료 상태

  // 입력값
  const [inputsPOS,setInputsPOS] = useState({noun:"",verb:"",adj:""}); // en2ko용
  const [inputEN,setInputEN] = useState("");                            // ko2en용

  // 기록 테이블
  const [history, setHistory] = useState([]); // [{no, word, meaningText, myInput, correct, rec}...]

  // 단어 보기 (검색/필터)
  const [showWords, setShowWords] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [posFilter, setPosFilter] = useState({ noun:false, verb:false, adj:false });

  const cur = questions[idx];

  // 포커스 관리용 ref들
  const containerRef = useRef(null);
  const nounRef = useRef(null);
  const verbRef = useRef(null);
  const adjRef  = useRef(null);
  const enRef   = useRef(null);

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

  // 오답만 다시 풀기(완료 화면에서 노출)
  const retryWrong = ()=>{
    const wrong = history.filter(h => !h.correct);
    if (wrong.length === 0) {
      alert("오답이 없습니다!");
      return;
    }
    const qs = wrong.map(h => ({ ...h.rec }));
    const shuffled = [...qs].sort(()=>Math.random()-0.5);
    setQuestions(shuffled);
    setIdx(0); setScore(0); setRevealed(false); setFinished(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
    setHistory([]); // 새 라운드를 위해 비움(원하면 유지하도록 바꿀 수 있음)
    requestAnimationFrame(() => focusFirstInput(false));
  };

  // 현재 문제 품사
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
  };

  // 다음
  const next = ()=>{
    if(idx+1 >= questions.length){
      // ✅ 완료 처리: 문제 카드 숨기고 완료 화면(풀이 기록 + 버튼만)
      setFinished(true);
      setQuestions([]); // 카드 감추기
      setIdx(0);
      setRevealed(false);
      // score는 기록으로 추후 확인 가능
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

  // 전역 Enter(제출/다음)
  useEffect(()=>{
    const handler = (e)=>{
      if(e.key !== "Enter") return;
      // 완료 화면에서는 엔터 동작 안 함(원하면 오답만 다시 풀기 실행 등으로 커스텀 가능)
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
        </div>
      )}

      {/* 풀이 기록 (진행 중에도 보이고, 완료 후에는 버튼이 여기서 노출) */}
      {history.length > 0 && (
        <div style={{ marginTop:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:8, flexWrap:"wrap" }}>
            <h3 style={{ margin:0 }}>
              풀이 기록{finished ? " (라운드 완료)" : ""}
            </h3>

            {/* ✅ 완료 후에만 버튼 노출 */}
            {finished && (
              <div style={{ display:"flex", gap:8 }}>
                <button
                  onClick={retryWrong}
                  style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
                >
                  오답만 다시 풀기
                </button>
                <button
                  onClick={()=>resetAll(false)}
                  style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
                >
                  다시 풀기(초기화)
                </button>
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

          {/* ✅ 완료 후에만 하단 버튼 노출 */}
          {finished && (
            <div style={{ marginTop:8, textAlign:"right" }}>
              <button
                onClick={retryWrong}
                style={{ marginRight:8, padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
              >
                오답만 다시 풀기
              </button>
              <button
                onClick={()=>resetAll(false)}
                style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
              >
                다시 풀기(초기화)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== 작은 스타일 헬퍼 ===== */
const inputStyle = {
  width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #ccc"
};
const th = { padding:"10px", borderBottom:"1px solid #eee", textAlign:"left" };
const td = { padding:"10px", borderBottom:"1px solid #f3f3f3", verticalAlign:"top" };
