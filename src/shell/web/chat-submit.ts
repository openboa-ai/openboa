export interface ChatComposerSubmitKeyInput {
  key: string
  shiftKey: boolean
  isComposing?: boolean
  keyCode?: number
  which?: number
}

export function shouldSubmitChatComposerFromKeyInput(input: ChatComposerSubmitKeyInput): boolean {
  if (input.key !== "Enter" || input.shiftKey) {
    return false
  }
  if (input.isComposing || input.keyCode === 229 || input.which === 229) {
    return false
  }
  return true
}

export function createChatSingleFlightGate() {
  let inFlight = false

  return async <T>(operation: () => Promise<T>): Promise<{ started: boolean; value?: T }> => {
    if (inFlight) {
      return { started: false }
    }

    inFlight = true
    try {
      return {
        started: true,
        value: await operation(),
      }
    } finally {
      inFlight = false
    }
  }
}
