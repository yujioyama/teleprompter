import { useNavigate } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import BgmSettings from '../components/BgmSettings'
import SubtitlePositionSettings from '../components/SubtitlePositionSettings'
import ScriptBackup from '../components/ScriptBackup'
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
        <div className={styles.sectionTitle}>音声</div>

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>音量の自動調整</div>
            <div className={styles.rowSub}>SNS投稿に最適な音量に自動調整します</div>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={settings.normalizeAudio}
              onChange={e => updateSettings({ normalizeAudio: e.target.checked })}
            />
            <span className={styles.toggleTrack} />
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>BGM</div>
        <BgmSettings trackId={settings.defaultBgmId} volume={settings.bgmVolume} onChange={updateSettings} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>字幕の位置</div>
        <div className={styles.rowSub}>短い字幕と長い字幕のどちらも見やすい位置に合わせてください（動画ごとに調整も可）</div>
        <SubtitlePositionSettings
          position={settings.subtitlePosition}
          onChange={subtitlePosition => updateSettings({ subtitlePosition })}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>自動トリミング</div>

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>無音部分を自動カット</div>
            <div className={styles.rowSub}>仕上げで前後の無音を自動カットします（あとから調整可）</div>
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
              <div className={styles.rowLabel}>前に残す時間</div>
              <div className={styles.rowSub}>音声の前に保持する無音の長さ</div>
            </div>
            <span className={styles.sliderValue}>{settings.trimPaddingStart.toFixed(1)}秒</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={0.2}
            max={2.0}
            step={0.1}
            value={settings.trimPaddingStart}
            onChange={e => updateSettings({ trimPaddingStart: parseFloat(e.target.value) })}
            disabled={!settings.trimEnabled}
          />
        </div>

        <div className={`${styles.row} ${styles.sliderRow} ${!settings.trimEnabled ? styles.disabled : ''}`}>
          <div className={styles.sliderHeader}>
            <div>
              <div className={styles.rowLabel}>後ろに残す時間</div>
              <div className={styles.rowSub}>音声の後ろに保持する無音の長さ</div>
            </div>
            <span className={styles.sliderValue}>{settings.trimPaddingEnd.toFixed(1)}秒</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={0.2}
            max={2.0}
            step={0.1}
            value={settings.trimPaddingEnd}
            onChange={e => updateSettings({ trimPaddingEnd: parseFloat(e.target.value) })}
            disabled={!settings.trimEnabled}
          />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>バックアップ</div>
        <ScriptBackup />
      </div>
    </div>
  )
}
