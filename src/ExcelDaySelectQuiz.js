import React, { useMemo, useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

// ===== utils =====
const split = (s = "") => s.split(/[\/,;|]/g).map(v => v.trim()).filter(Boolean);
const normKo = (s = "") => s.replace(/\s+/g, " ").trim().replace(/[.,!?(){}[\]'“”‘’"]/g, "");
const normEn = (s = "") => s.replace(/\s+/g, " ").trim().toLowerCase();
function formatDayKey(v){ if(v==null) return ""; const val=String(v).trim(); if(!isNaN(v)&&val!=="") return val; return val; }

// ===== main component =====
export default function ExcelDaySelectQuiz(){
  // 데이터/선택
  const [rows,setRows] = useState([]);
  const [dayKeys,setDayKeys] = useState([]);
  const [checkedDays,setCheckedDays] = useState({});
  // 모드/문제 상태
  const [mode,setMode] = useState("en2ko"); // 'en2ko' = 영어→한글(품사별), 'ko2en' = 한글→영어
  const [questions,setQuestions] = useState([]);
  const [idx,setIdx] = useState(0);
  const [revealed,setRevealed] = useState(false);
  const [score,setScore] = useState(0);

  // 입력값
  const [inputsPOS,setInputsPOS] = useState({noun:"",verb:"",adj:""}); // en2ko용
  const [inputEN,setInputEN] = useState("");                            // ko2en용

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
    setQuestions([]); setIdx(0); setScore(0); setRevealed(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
  };

  // 날짜 체크
  const toggleDay = (k)=> setCheckedDays(prev=>({ ...prev, [k]: !prev[k] }));

  // 문제 생성
  const buildQuestions = ()=>{
    const pickDays = Object.entries(checkedDays).filter(([,v])=>v).map(([k])=>k);
    if(!pickDays.length){ alert("최소 1개 이상의 날짜를 선택하세요."); return; }
    const picked = rows.filter(r=>pickDays.includes(r.dayKey));
    const qs = picked.map(r=>({ word:r.word, noun:r.noun, verb:r.verb, adj:r.adj, dayKey:r.dayKey }));
    const shuffled = [...qs].sort(()=>Math.random()-0.5);

    setQuestions(shuffled);
    setIdx(0); setScore(0); setRevealed(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");

    // 시작 시 컨테이너 포커스(전역 Enter와 함께 안전장치)
    containerRef.current?.focus();

    // 다음 프레임에 첫 입력칸 포커스
    requestAnimationFrame(() => focusFirstInput(false)); // revealed=false
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
    const parts=[];
    if(cur.noun?.length) parts.push(`(명) ${cur.noun.join(" / ")}`);
    if(cur.verb?.length) parts.push(`(동) ${cur.verb.join(" / ")}`);
    if(cur.adj ?.length) parts.push(`(형) ${cur.adj.join(" / ")}`);
    return parts.join(" · ");
  },[cur]);

  // 채점
  const check = ()=>{
    if(!cur) return;
    let ok=false;
    if(mode==="en2ko"){
      ok = presentPOS.every(pos=>{
        const user = normKo(inputsPOS[pos]||"");
        const targets = (cur[pos]||[]).map(normKo);
        return user && targets.includes(user);
      });
    }else{
      ok = normEn(inputEN) === normEn(cur.word);
    }
    if(ok) setScore(s=>s+1);
    setRevealed(true);
    // 정답 공개 상태에서는 입력칸 disabled → 포커스 이동 필요 X
  };

  // 다음
  const next = ()=>{
    if(idx+1 >= questions.length){
      alert(`완료! 점수: ${score}/${questions.length}`);
      setIdx(0); setScore(0); setRevealed(false);
      setQuestions(qs=>[...qs].sort(()=>Math.random()-0.5));
      setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
      // 다음 프레임에 첫 입력칸 포커스
      requestAnimationFrame(() => focusFirstInput(false));
      return;
    }
    setIdx(idx+1); setRevealed(false);
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN("");
    // 다음 프레임에 첫 입력칸 포커스
    requestAnimationFrame(() => focusFirstInput(false));
  };

  // 첫 입력칸 포커스 함수
  const focusFirstInput = (isRevealed = revealed)=>{
    if(isRevealed) return; // 정답 공개 중엔 입력칸이 disabled
    if(mode==="en2ko"){
      if(nounRef.current){ nounRef.current.focus(); return; }
      if(verbRef.current){ verbRef.current.focus(); return; }
      if(adjRef.current ){ adjRef.current.focus();  return; }
    }else{
      if(enRef.current){ enRef.current.focus(); return; }
    }
  };

  // 전역 Enter (어디 포커스든 Enter로 제출/다음)
  useEffect(()=>{
    const handler = (e)=>{
      if(e.key !== "Enter") return;
      // 파일 다이얼로그/폼 submit 충돌 방지
      e.preventDefault();
      if(questions.length === 0) return; // 아직 시작 전
      if(!revealed) check(); else next();
    };
    window.addEventListener("keydown", handler);
    return ()=> window.removeEventListener("keydown", handler);
  }, [questions.length, revealed, idx, mode, inputsPOS, inputEN]);

  // 모드/문제/정답창 상태 변화 후, 다음 프레임에 포커스 보장
  useEffect(()=>{
    const id = requestAnimationFrame(()=>focusFirstInput());
    return ()=> cancelAnimationFrame(id);
  }, [idx, mode, revealed]);

  // 모드 바뀌면 입력 초기화
  useEffect(()=>{
    setInputsPOS({noun:"",verb:"",adj:""}); setInputEN(""); setRevealed(false);
  },[mode]);

  return (
    <div
      ref={containerRef}
      style={{ maxWidth: 900, margin:"2rem auto", padding:"0 1rem" }}
      tabIndex={-1}
    >
      <h1 style={{ textAlign:"center", marginBottom:"1rem" }}>
        엑셀 단어 학습 (날짜 선택형)
      </h1>

      <input type="file" accept=".xlsx,.xls" onChange={onFile} />

      {dayKeys.length>0 && (
        <div style={{ marginTop:16, padding:12, border:"1px solid #ddd", borderRadius:12 }}>
          <div style={{ fontWeight:600, marginBottom:8 }}>날짜 선택:</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:12 }}>
            {dayKeys.map(k=>{
              const count = rows.filter(r=>r.dayKey===k).length;
              return (
                <label key={k} style={{ display:"flex", gap:6 }}>
                  <input
                    type="checkbox"
                    checked={!!checkedDays[k]}
                    onChange={()=>toggleDay(k)}
                  />
                  <span>{k} ({count}개)</span>
                </label>
              );
            })}
          </div>

          <div style={{ marginTop:10, display:"flex", gap:10 }}>
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
              style={{ marginLeft:"auto", padding:"6px 12px", borderRadius:8, border:"1px solid #ccc" }}
            >
              선택한 날짜로 시작
            </button>
          </div>
        </div>
      )}

      {cur && (
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
                      style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #ccc" }}
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
                      style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #ccc" }}
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
                      style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #ccc" }}
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
                style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #ccc" }}
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
    </div>
  );
}
