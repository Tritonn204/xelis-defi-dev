import { createContext, useContext, useState, type ReactNode } from 'react'

export interface ModuleContractField {
  key: string
  label: string
  required?: boolean
  default?: string
}

interface ModuleRegistry {
  [moduleName: string]: ModuleContractField[]
}

interface ContractValues {
  [contractKey: string]: string // actual user-provided addresses
}

interface ModuleContextType {
  registerModule: (name: string, fields: ModuleContractField[]) => void
  getContracts: () => ModuleRegistry
  setContractAddress: (key: string, value: string) => void
  getContractAddress: (key: string) => string | undefined
  getAllContractAddresses: () => ContractValues
  clearModules: () => void
  contractValues: ContractValues
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined)

export const ModuleProvider = ({ children }: { children: ReactNode }) => {
  const [modules, setModules] = useState<ModuleRegistry>({})
  const [contractValues, setContractValues] = useState<ContractValues>({})

  const registerModule = (name: string, fields: ModuleContractField[]) => {
    setModules(prev => ({
      ...prev,
      [name]: fields
    }))

    setContractValues(prev => {
      const updated = { ...prev }
      for (const field of fields) {
        if (field.default && !updated[field.key]) {
          updated[field.key] = field.default
        }
      }
      return updated
    })
  }

  const getContracts = () => modules

  const setContractAddress = (key: string, value: string) => {
    setContractValues(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const getContractAddress = (key: string) => contractValues[key]

  const getAllContractAddresses = () => contractValues

  const clearModules = () => {
    setModules({})
    setContractValues({})
  }

  return (
    <ModuleContext.Provider
      value={{
        registerModule,
        getContracts,
        setContractAddress,
        getContractAddress,
        getAllContractAddresses,
        clearModules,
        contractValues
      }}
    >
      {children}
    </ModuleContext.Provider>
  )
}

export const useModuleContext = () => {
  const ctx = useContext(ModuleContext)
  if (!ctx) {
    throw new Error('useModuleContext must be used within a ModuleProvider')
  }
  return ctx
}
