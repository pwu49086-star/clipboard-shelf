import { useState, useEffect } from 'react'
import { ArrowLeft, Heart, Star, BarChart3, Trophy, MousePointer, Move, Clock, Zap, Award, Gem, Smile, Copy, Bookmark, Calendar, ChevronRight, Eye } from 'lucide-react'

const ACHIEVES = [
  { icon: <Copy size={16} />, name: '初学者', desc: '复制10次', stat: 'copies', need: 10 },
  { icon: <Star size={16} />, name: '收藏家', desc: '复制100次', stat: 'copies', need: 100 },
  { icon: <Bookmark size={16} />, name: '精选者', desc: '收藏10条', stat: 'favorites', need: 10 },
  { icon: <Calendar size={16} />, name: '忠实用户', desc: '使用7天', stat: 'days', need: 7 },
  { icon: <Award size={16} />, name: '大师', desc: '复制1000次', stat: 'copies', need: 1000 },
  { icon: <Clock size={16} />, name: '老朋友', desc: '使用30天', stat: 'days', need: 30 },
  { icon: <Zap size={16} />, name: '亲密伙伴', desc: '达到5级', stat: 'level', need: 5 },
  { icon: <Gem size={16} />, name: '灵魂伴侣', desc: '达到10级', stat: 'level', need: 10 },
  { icon: <Smile size={16} />, name: '开心果', desc: '心情达到100', stat: 'mood', need: 100 },
]

export default function PetSettings({ onBack }) {
  const [stats, setStats] = useState({ copies: 0, favorites: 0, days: 0, level: 1, mood: 80, energy: 100, curiosity: 50, favor: 0 })
  const [tab, setTab] = useState('info')
  const [tasks, setTasks] = useState(null)
  const [skinMsg, setSkinMsg] = useState('')

  useEffect(() => {
    try {
      const copies = parseInt(localStorage.getItem('pet-copies') || '0')
      const favorites = parseInt(localStorage.getItem('pet-favorites') || '0')
      const level = parseInt(localStorage.getItem('pet-level') || '1')
      const mood = parseInt(localStorage.getItem('pet-mood') || '80')
      const energy = parseInt(localStorage.getItem('pet-energy') || '100')
      const curiosity = parseInt(localStorage.getItem('pet-curiosity') || '50')
      const favor = parseInt(localStorage.getItem('pet-favor') || '0')
      const firstUse = localStorage.getItem('pet-first-use')
      const days = firstUse ? Math.floor((Date.now() - parseInt(firstUse)) / 86400000) : 0
      setStats({ copies, favorites, days, level, mood, energy, curiosity, favor })
    } catch {}
  }, [])

  useEffect(() => {
    if (window.api?.tasksGetState) window.api.tasksGetState().then(setTasks).catch(() => {})
  }, [])

  return (
    <div className="app">
      <div className="settings-header">
        <button className="settings-back" onClick={onBack}><ArrowLeft size={16} /></button>
        <span className="settings-title">宠物小窝</span>
      </div>

      <div className="pet-tabs">
        <button className={`pet-tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>状态</button>
        <button className={`pet-tab ${tab === 'achieve' ? 'active' : ''}`} onClick={() => setTab('achieve')}>成就</button>
        <button className={`pet-tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>任务</button>
      </div>

      <div className="settings-body">
        {tab === 'info' && (
          <>
            {/* 宠物卡片 */}
            <div className="setting-group pet-card">
              <div className="pet-avatar">🫧</div>
              <div className="pet-name">史莱姆</div>
              <div className="pet-level">Lv.{stats.level}</div>
            </div>

            {/* 属性 */}
            <div className="setting-group">
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name"><Heart size={14} style={{color:'#ff6b6b',marginRight:6}} />心情</span>
                  <span className="setting-desc">决定表情，鼠标靠近/复制提升</span>
                </div>
                <div className="pet-bar-wrap">
                  <div className="pet-bar"><div className="pet-bar-fill mood" style={{ width: stats.mood + '%' }}></div></div>
                  <span className="pet-bar-value">{stats.mood}%</span>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name"><Zap size={14} style={{color:'#ffd200',marginRight:6}} />能量</span>
                  <span className="setting-desc">决定动画速度，睡觉恢复</span>
                </div>
                <div className="pet-bar-wrap">
                  <div className="pet-bar"><div className="pet-bar-fill energy" style={{ width: stats.energy + '%' }}></div></div>
                  <span className="pet-bar-value">{stats.energy}%</span>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name"><Eye size={14} style={{color:'#A8E6FF',marginRight:6}} />好奇心</span>
                  <span className="setting-desc">决定随机行为频率，活跃时提升</span>
                </div>
                <div className="pet-bar-wrap">
                  <div className="pet-bar"><div className="pet-bar-fill curiosity" style={{ width: stats.curiosity + '%' }}></div></div>
                  <span className="pet-bar-value">{stats.curiosity}%</span>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <span className="setting-name"><Star size={14} style={{color:'#ffd200',marginRight:6}} />好感度</span>
                  <span className="setting-desc">收藏、拖拽提升</span>
                </div>
                <span className="setting-value">{stats.favor}</span>
              </div>
            </div>

            {/* 统计 */}
            <div className="setting-group">
              <div className="setting-row"><div className="setting-label"><span className="setting-name"><BarChart3 size={14} style={{marginRight:6}} />数据统计</span></div></div>
              <div className="stats-grid">
                <div className="stat-item"><span className="stat-value">{stats.copies}</span><span className="stat-label">复制</span></div>
                <div className="stat-item"><span className="stat-value">{stats.favorites}</span><span className="stat-label">收藏</span></div>
                <div className="stat-item"><span className="stat-value">{stats.days}</span><span className="stat-label">天数</span></div>
                <div className="stat-item"><span className="stat-value">Lv.{stats.level}</span><span className="stat-label">等级</span></div>
              </div>
            </div>

            {/* 交互说明 */}
            <div className="setting-group">
              <div className="setting-row"><div className="setting-label"><span className="setting-name"><MousePointer size={14} style={{marginRight:6}} />交互方式</span></div></div>
              <div className="guide-list">
                <div className="guide-item"><span className="guide-icon"><MousePointer size={14} /></span><div className="guide-content"><div className="guide-item-title">鼠标靠近</div><div className="guide-item-desc">主窗口自动弹出</div></div></div>
                <div className="guide-item"><span className="guide-icon"><ChevronRight size={14} /></span><div className="guide-content"><div className="guide-item-title">点击</div><div className="guide-item-desc">展开主窗口</div></div></div>
                <div className="guide-item"><span className="guide-icon"><Move size={14} /></span><div className="guide-content"><div className="guide-item-title">拖拽</div><div className="guide-item-desc">移动宠物位置</div></div></div>
              </div>
            </div>
          </>
        )}

        {tab === 'tasks' && (
          <>
            <div className="setting-group">
              <div className="setting-row"><div className="setting-label"><span className="setting-name"><Calendar size={14} style={{marginRight:6}} />今日任务</span></div></div>
              {tasks ? tasks.tasks.map(t => {
                const done = !!tasks.done[t.key]
                const val = tasks.counts[t.countKey] || 0
                const progress = Math.min(100, Math.round(val / t.need * 100))
                return (
                  <div key={t.key} className={`guide-item ${done ? 'task-done' : ''}`}>
                    <span className="guide-icon">{done ? <span style={{fontSize:14}}>✅</span> : <Trophy size={14} />}</span>
                    <div className="guide-content">
                      <div className="guide-item-title">{t.name}{done ? '（已完成）' : ''}</div>
                      <div className="guide-item-desc">{t.desc} ({val}/{t.need})</div>
                      {!done && <div className="achieve-progress"><div className="achieve-bar" style={{ width: progress + '%' }}></div></div>}
                    </div>
                  </div>
                )
              }) : <div className="setting-hint">加载中…</div>}
              {tasks && <div className="setting-hint">已收集 {tasks.points} / {tasks.tasks.length} 颗星</div>}
            </div>

            <div className="setting-group">
              <div className="setting-row"><div className="setting-label"><span className="setting-name"><Star size={14} style={{marginRight:6}} />皮肤</span></div></div>
              <div className="skin-grid">
                {tasks ? tasks.skins.map(s => {
                  const unlocked = tasks.unlocked.includes(s.id)
                  let activeSkin = 'default'
                  try { activeSkin = localStorage.getItem('pet-skin') || 'default' } catch {}
                  return (
                    <button
                      key={s.id}
                      className={`skin-cell ${unlocked ? '' : 'locked'} ${activeSkin === s.id ? 'active' : ''}`}
                      disabled={!unlocked}
                      onClick={async () => {
                        const r = await window.api.tasksSelectSkin(s.id)
                        if (r && r.error) setSkinMsg(r.error)
                        else {
                          try { localStorage.setItem('pet-skin', s.id) } catch {}
                          setSkinMsg('已切换到 ' + s.name)
                          setTasks(await window.api.tasksGetState())
                        }
                      }}
                    >
                      <span className={`skin-dot skin-${s.id}`}></span>
                      <span className="skin-name">{s.name}</span>
                      <span className="skin-desc">{unlocked ? s.desc : '🔒 未解锁'}</span>
                    </button>
                  )
                }) : <div className="setting-hint">加载中…</div>}
              </div>
              {skinMsg && <div className="setting-hint">{skinMsg}</div>}
            </div>
          </>
        )}

        {tab === 'achieve' && (
          <>
            <div className="setting-group">
              <div className="setting-row"><div className="setting-label"><span className="setting-name"><BarChart3 size={14} style={{marginRight:6}} />我的进度</span></div></div>
              <div className="stats-grid">
                <div className="stat-item"><span className="stat-value">{stats.copies}</span><span className="stat-label">复制</span></div>
                <div className="stat-item"><span className="stat-value">{stats.favorites}</span><span className="stat-label">收藏</span></div>
                <div className="stat-item"><span className="stat-value">{stats.days}</span><span className="stat-label">天数</span></div>
                <div className="stat-item"><span className="stat-value">Lv.{stats.level}</span><span className="stat-label">等级</span></div>
              </div>
            </div>
            <div className="setting-group">
              <div className="setting-row"><div className="setting-label"><span className="setting-name"><Trophy size={14} style={{marginRight:6}} />成就列表</span></div></div>
              <div className="guide-list">
                {ACHIEVES.map((a, i) => {
                  const val = stats[a.stat] || 0
                  const unlocked = val >= a.need
                  const progress = Math.min(100, Math.round(val / a.need * 100))
                  return (
                    <div key={i} className={`guide-item ${unlocked ? '' : 'locked-achieve'}`}>
                      <span className="guide-icon">{a.icon}</span>
                      <div className="guide-content">
                        <div className="guide-item-title">{a.name}</div>
                        <div className="guide-item-desc">{a.desc} ({val}/{a.need})</div>
                        {!unlocked && <div className="achieve-progress"><div className="achieve-bar" style={{ width: progress + '%' }}></div></div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
