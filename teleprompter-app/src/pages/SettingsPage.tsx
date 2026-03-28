import { useNavigate } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const navigate = useNavigate()
  const [settings, updateSettings] = useSettings()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>‹</button>
        <h1 className={styles.title}>設定</h1>
      </header>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>自動トリミング</div>

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>無音部分を自動カット</div>
            <div className={styles.rowSub}>録画後に前後の無音を除去します</div>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={settings.trimEnabled}
              onChange={e => updateSettings({ trimEnabled: e.target.checked })}
            />
            <span className={styles.toggleTrack} />
          </label>
        </div>

        <div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
          <div className={styles.sliderHeader}>
            <div>
              <div className={styles.rowLabel}>前後に残す時間</div>
              <div className={styles.rowSub}>音声の前後に保持する無音の長さ</div>
            </div>
            <span className={styles.sliderValue}>{settings.trimPadding.toFixed(1)}秒</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={0.2}
            max={2.0}
            step={0.1}
            value={settings.trimPadding}
            onChange={e => updateSettings({ trimPadding: parseFloat(e.target.value) })}
            disabled={!settings.trimEnabled}
          />
        </div>
      </div>
    </div>
  )
}
