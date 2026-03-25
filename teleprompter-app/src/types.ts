export interface Shot {
  id: string
  text: string
}

export interface Script {
  id: string
  title: string
  shots: Shot[]
  createdAt: string
  updatedAt: string
}
