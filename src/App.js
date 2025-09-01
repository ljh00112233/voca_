// src/App.js
import React from 'react';
import './App.css';
import ExcelDaySelectQuiz from './ExcelDaySelectQuiz';  // 내가 만든 컴포넌트 import

function App() {
  return (
    <div className="App">
      <ExcelDaySelectQuiz /> {/* 여기서 바로 출력 */}
    </div>
  );
}

export default App;
