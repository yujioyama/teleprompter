import { Component, type ReactNode } from 'react'
import styles from './LoadErrorBoundary.module.css'

/**
 * Catches a screen that couldn't be loaded or drawn, which otherwise leaves
 * the page blank. The usual cause is a screen's code asked for after a new
 * build went out: the running build's files are gone from the server.
 * Reloading picks the new build up.
 */
export default class LoadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('A screen could not be shown', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className={styles.wrapper} role="alert">
        <p className={styles.message}>画面を読み込めませんでした</p>
        <p className={styles.hint}>アプリが更新された可能性があります。再読み込みすると直ります。</p>
        <button className={styles.reload} onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </div>
    )
  }
}
