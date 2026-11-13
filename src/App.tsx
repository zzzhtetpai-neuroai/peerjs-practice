import { useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import { QRCodeSVG } from 'qrcode.react'

type FloatingText = { id: number; text: string; left: number }
type Remote = { peerId: string; stream: MediaStream }
type PhoneStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// If the URL has ?peer=xxxx it's the phone, otherwise it's the PC
const params = new URLSearchParams(window.location.search)
const targetPeerId = params.get('peer')

const QUICK_MESSAGES = ['👏', '❤️', '😂', '🔥', 'すごい！', 'いいね！']

function App() {
  return targetPeerId ? <PhoneView pcId={targetPeerId} /> : <PcView />
}

// Shows one video stream
function VideoTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])

  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover" />
}

/* ---------------- PC screen ---------------- */

function PcView() {
  const [myId, setMyId] = useState('')
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [texts, setTexts] = useState<FloatingText[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const peer = new Peer()

    const removeRemote = (peerId: string) => {
      setRemotes((prev) => prev.filter((r) => r.peerId !== peerId))
    }

    const addText = (text: string) => {
      const id = Date.now() + Math.random()
      const left = 15 + Math.random() * 70
      setTexts((prev) => [...prev, { id, text, left }])
      setTimeout(() => {
        setTexts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    }

    // Got my own ID from the PeerJS server
    peer.on('open', (id) => setMyId(id))
    peer.on('error', (err) => setError(err.type))

    // A phone is sending video
    peer.on('call', (call: MediaConnection) => {
      call.answer()
      call.on('stream', (stream) => {
        setRemotes((prev) =>
          prev.some((r) => r.peerId === call.peer) ? prev : [...prev, { peerId: call.peer, stream }],
        )
      })
      call.on('close', () => removeRemote(call.peer))
    })

    // A phone is sending text
    peer.on('connection', (conn: DataConnection) => {
      conn.on('data', (data) => {
        if (typeof data === 'string') addText(data)
      })
      conn.on('close', () => removeRemote(conn.peer))
    })

    return () => peer.destroy()
  }, [])

  const joinUrl = myId ? `${window.location.origin}${window.location.pathname}?peer=${myId}` : ''

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6">
      <h1 className="text-2xl md:text-3xl font-bold mb-4">PeerJS ライブカメラ（PC）</h1>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left: ID, QR, connection count */}
        <div className="bg-slate-900 rounded-2xl p-5 space-y-4 h-fit">
          <div>
            <p className="text-sm text-slate-400">PCのPeer ID</p>
            <p className="font-mono text-sm break-all">{myId || '取得中...'}</p>
          </div>

          {joinUrl && (
            <div className="bg-white p-3 rounded-xl w-fit mx-auto">
              <QRCodeSVG value={joinUrl} size={200} />
            </div>
          )}
          <p className="text-sm text-slate-400 text-center">スマホのカメラでQRコードを読み取ってください</p>

          <div className="bg-slate-800 rounded-xl p-3 text-center">
            <p className="text-sm text-slate-400">接続中のスマホ</p>
            <p className="text-3xl font-bold">{remotes.length} 台</p>
          </div>

          {error && <p className="text-red-400 text-sm">エラー: {error}</p>}
        </div>

        {/* Right: videos with floating text on top */}
        <div className="relative bg-black rounded-2xl overflow-hidden min-h-[60vh]">
          {remotes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500">
              スマホの接続を待っています...
            </div>
          ) : (
            <div className={`grid h-full ${remotes.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {remotes.map((r) => (
                <VideoTile key={r.peerId} stream={r.stream} />
              ))}
            </div>
          )}

          {texts.map((t) => (
            <div
              key={t.id}
              className="float-up absolute bottom-8 text-3xl md:text-4xl font-bold text-white pointer-events-none whitespace-nowrap"
              style={{ left: `${t.left}%`, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
            >
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Phone screen ---------------- */

function PhoneView({ pcId }: { pcId: string }) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<PhoneStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [text, setText] = useState('')
  const peerRef = useRef<Peer | null>(null)
  const connRef = useRef<DataConnection | null>(null)

  useEffect(() => {
    let localStream: MediaStream | null = null
    let peer: Peer | null = null
    let cancelled = false

    if (!navigator.mediaDevices) {
      setStatus('error')
      setErrorMsg('カメラを使うには https のページで開いてください')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        localStream = s
        setStream(s)

        peer = new Peer()
        peerRef.current = peer

        peer.on('open', () => {
          if (!peer) return
          // 1) Open the text channel first
          const conn = peer.connect(pcId, { reliable: true })
          connRef.current = conn
          conn.on('open', () => {
            setStatus('connected')
            // 2) Then send the video
            if (peer && localStream) peer.call(pcId, localStream)
          })
          conn.on('close', () => setStatus('disconnected'))
          conn.on('error', (err) => {
            setStatus('error')
            setErrorMsg(err.message)
          })
        })

        peer.on('error', (err) => {
          setStatus('error')
          setErrorMsg(err.message)
        })
      })
      .catch((err: unknown) => {
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : 'カメラを起動できませんでした')
      })

    return () => {
      cancelled = true
      peer?.destroy()
      localStream?.getTracks().forEach((t) => t.stop())
    }
  }, [pcId])

  const send = (message: string) => {
    const conn = connRef.current
    const trimmed = message.trim()
    if (!conn || !conn.open || trimmed === '') return
    conn.send(trimmed)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    send(text)
    setText('')
  }

  const disconnect = () => {
    peerRef.current?.destroy()
    stream?.getTracks().forEach((t) => t.stop())
    setStatus('disconnected')
  }

  const statusLabel = {
    connecting: { text: '接続中...', color: 'bg-yellow-500' },
    connected: { text: '接続済み', color: 'bg-green-500' },
    disconnected: { text: '切断しました', color: 'bg-slate-500' },
    error: { text: 'エラー', color: 'bg-red-500' },
  }[status]

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 pb-32 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">PeerJS ライブカメラ（スマホ）</h1>
        <span className={`${statusLabel.color} text-sm px-3 py-1 rounded-full`}>{statusLabel.text}</span>
      </div>

      <div className="bg-black rounded-2xl overflow-hidden h-[40vh]">
        {stream ? (
          <VideoTile stream={stream} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-500">カメラを準備中...</div>
        )}
      </div>

      {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}

      {/* Text input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="メッセージを入力"
          disabled={status !== 'connected'}
          className="flex-1 rounded-xl bg-slate-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status !== 'connected'}
          className="bg-blue-600 px-5 rounded-xl font-bold disabled:opacity-50"
        >
          送信
        </button>
      </form>

      {/* Tap to send */}
      <div className="grid grid-cols-3 gap-2">
        {QUICK_MESSAGES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => send(m)}
            disabled={status !== 'connected'}
            className="bg-slate-800 active:bg-slate-700 active:scale-95 transition rounded-xl py-4 text-2xl disabled:opacity-50 touch-manipulation"
          >
            {m}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={disconnect}
        disabled={status === 'disconnected'}
        className="w-full bg-red-600 rounded-xl py-3 font-bold disabled:opacity-50"
      >
        切断
      </button>
    </div>
  )
}

export default App