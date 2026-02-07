export interface FrappeEmployee {
  name: string // Frappe document ID
  employee_id: string // Badge number
  employee_name: string
  department?: string
  status: string
}

export interface EmployeeStatus {
  frappeId: string
  employeeId: string
  employeeName: string
  department?: string
  status: string
  isRegistered: boolean
  lastScan?: string
  totalScans: number
}

// Mock Frappe HR API - Replace with actual API call
export async function fetchFrappeEmployees(): Promise<FrappeEmployee[]> {
  // TODO: Replace with actual Frappe HR API call
  // const response = await fetch('https://your-frappe.com/api/resource/Employee', {
  //   headers: {
  //     'Authorization': 'token YOUR_API_KEY:YOUR_API_SECRET'
  //   }
  // })
  // return response.json()

  // Mock data for now
  return [
    {
      name: "EMP001",
      employee_id: "1",
      employee_name: "John Smith",
      department: "Engineering",
      status: "Active"
    },
    {
      name: "EMP002",
      employee_id: "2",
      employee_name: "Jane Doe",
      department: "HR",
      status: "Active"
    },
    {
      name: "EMP003",
      employee_id: "15",
      employee_name: "Bob Johnson",
      department: "Sales",
      status: "Active"
    },
    {
      name: "EMP004",
      employee_id: "20",
      employee_name: "Alice Williams",
      department: "Marketing",
      status: "Active"
    },
    {
      name: "EMP005",
      employee_id: "25",
      employee_name: "Charlie Brown",
      department: "Engineering",
      status: "Inactive"
    }
  ]
}
