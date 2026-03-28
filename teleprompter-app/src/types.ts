export interface Shot {
  id: string
  text: string
  trimEnabled?: boolean  // undefined = use global setting
  trimPaddingStart?: number
  trimPaddingEnd?: number
}

export interface Script {
  id: string
  title: string
  shots: Shot[]
  createdAt: string
  updatedAt: string
}
