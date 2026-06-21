/**
 * API Client for handling HTTP requests with automatic authentication
 * Separates API logic from authentication concerns
 */

export class APIError extends Error {
  public status: number
  public code?: string
  public details?: any

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: any
  ) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.code = code
    this.details = details
  }

  static fromResponse(response: Response, data?: any): APIError {
    return new APIError(
      data?.message || `HTTP ${response.status} - ${response.statusText}`,
      response.status,
      data?.code,
      data
    )
  }

  static networkError(error: any): APIError {
    return new APIError(
      'Network error - please check your connection',
      0,
      'NETWORK_ERROR',
      error
    )
  }
}

interface APIClientConfig {
  baseURL: string
  getToken: () => string | null
  onUnauthorized: () => void
  defaultHeaders?: Record<string, string>
}

export class APIClient {
  private config: APIClientConfig

  constructor(config: APIClientConfig) {
    this.config = config
  }

  /**
   * Get authorization headers with current token
   */
  private getAuthHeaders(): Record<string, string> {
    const token = this.config.getToken()
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }

  /**
   * Build complete headers for request
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
      ...this.getAuthHeaders(),
      ...customHeaders
    }
  }

  /**
   * Handle response and extract data or throw appropriate errors
   */
  private async handleResponse(response: Response): Promise<any> {
    // Handle successful responses
    if (response.ok) {
      const contentType = response.headers.get('content-type')
      
      if (contentType?.includes('application/json')) {
        return await response.json()
      }
      
      if (contentType?.includes('text/')) {
        return await response.text()
      }
      
      // For other content types, return the response itself
      return response
    }

    // Handle unauthorized responses (session invalidated)
    if (response.status === 401) {
     
      // Trigger auth cleanup
      this.config.onUnauthorized()
      
      // Try to get error details from response
      let errorData: any = {}
      try {
        errorData = await response.json()
      } catch {
        // Response might not be JSON, that's okay
      }
      
      throw new APIError(
        errorData.message || 'Your session has expired. Please log in again.',
        401,
        errorData.code || 'UNAUTHORIZED',
        errorData
      )
    }

    // Handle other error responses
    let errorData: any = {}
    try {
      errorData = await response.json()
    } catch {
      // Response might not be JSON
    }

    throw APIError.fromResponse(response, errorData)
  }

  /**
   * Make HTTP request with proper error handling
   */
  async request(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<any> {
    // Ensure endpoint starts with /
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const url = `${this.config.baseURL}${path}`

    // Build request configuration
    const requestConfig: RequestInit = {
      ...options,
      headers: this.buildHeaders(options.headers as Record<string, string>)
    }

    try {
      console.log(`🌐 ${options.method || 'GET'} ${path}`)
      
      const response = await fetch(url, requestConfig)
      return await this.handleResponse(response)
      
    } catch (error) {
      // Re-throw API errors as-is
      if (error instanceof APIError) {
        throw error
      }
      
      // Handle network errors
      console.error('Network error:', error)
      throw APIError.networkError(error)
    }
  }

  /**
   * GET request
   */
  async get(endpoint: string, headers?: Record<string, string>): Promise<any> {
    return this.request(endpoint, { 
      method: 'GET',
      headers 
    })
  }

  /**
   * POST request
   */
  async post(
    endpoint: string, 
    data?: any, 
    headers?: Record<string, string>
  ): Promise<any> {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      headers
    })
  }

  /**
   * PUT request
   */
  async put(
    endpoint: string, 
    data?: any, 
    headers?: Record<string, string>
  ): Promise<any> {
    return this.request(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      headers
    })
  }

  /**
   * PATCH request
   */
  async patch(
    endpoint: string, 
    data?: any, 
    headers?: Record<string, string>
  ): Promise<any> {
    return this.request(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
      headers
    })
  }

  /**
   * DELETE request
   */
  async delete(endpoint: string, headers?: Record<string, string>): Promise<any> {
    return this.request(endpoint, { 
      method: 'DELETE',
      headers 
    })
  }

  /**
   * Upload file (multipart/form-data)
   */
  async upload(
    endpoint: string,
    formData: FormData,
    headers?: Record<string, string>
  ): Promise<any> {
    // Don't set Content-Type for FormData - browser will set it with boundary
    const uploadHeaders = { ...headers }
    delete uploadHeaders['Content-Type']
    
    return this.request(endpoint, {
      method: 'POST',
      body: formData,
      headers: uploadHeaders
    })
  }

  /**
   * Download file (returns blob)
   */
  async download(endpoint: string, headers?: Record<string, string>): Promise<Blob> {
    const requestConfig: RequestInit = {
      method: 'GET',
      headers: this.buildHeaders(headers)
    }
    
    const url = `${this.config.baseURL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
    
    try {
      const response = await fetch(url, requestConfig)
      
      if (response.status === 401) {
        this.config.onUnauthorized()
        throw new APIError('Unauthorized', 401, 'UNAUTHORIZED')
      }
      
      if (!response.ok) {
        throw APIError.fromResponse(response)
      }
      
      return await response.blob()
      
    } catch (error) {
      if (error instanceof APIError) {
        throw error
      }
      throw APIError.networkError(error)
    }
  }
}

/**
 * Create APIClient instance with default configuration
 */
export function createAPIClient(config: {
  baseURL?: string
  getToken: () => string | null
  onUnauthorized: () => void
}): APIClient {
  return new APIClient({
    baseURL: config.baseURL || process.env.REACT_APP_API_URL || 'http://localhost:8080/api',
    getToken: config.getToken,
    onUnauthorized: config.onUnauthorized,
    defaultHeaders: {
      'Accept': 'application/json'
    }
  })
}