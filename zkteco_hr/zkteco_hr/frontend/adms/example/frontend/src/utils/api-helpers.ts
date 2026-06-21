/**
 * Shared API utilities for service layer
 * Provides consistent auth headers and error handling across all services
 */

/**
 * Get authentication token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem('diu_auth_token')
}

/**
 * Get authentication headers for API requests
 * @param excludeContentType - Set to true for requests that don't need Content-Type (GET, DELETE, or FormData)
 * @throws Error if authentication token is not found
 */
export function getAuthHeaders(excludeContentType = false): Record<string, string> {
  const token = getAuthToken()
  if (!token) {
    throw new Error('Authentication token not found. Please log in again.')
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  }

  if (!excludeContentType) {
    headers['Content-Type'] = 'application/json'
  }

  return headers
}

/**
 * Build query string from filter object
 * Automatically excludes undefined, null, and empty string values
 */
export function buildQueryString(filters: Record<string, any> = {}): string {
  const searchParams = new URLSearchParams()
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.append(key, String(value))
    }
  })

  return searchParams.toString()
}

/**
 * Handle API response and errors consistently
 * Parses JSON responses and extracts error messages
 */
export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = `API error: ${response.status} ${response.statusText}`
    
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorMessage
    } catch {
      // Fallback to response text if not JSON
      errorMessage = errorText || errorMessage
    }
    
    throw new Error(errorMessage)
  }

  return response.json()
}
