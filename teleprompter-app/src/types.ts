export interface Shot {
  id: string
  text: string
  trimEnabled?: boolean  // undefined = use global setting
  trimPadding?: number   // undefined = use global setting
}

export interface Script {
  id: string
  title: string
  shots: Shot[]
  createdAt: string
  updatedAt: string
}
