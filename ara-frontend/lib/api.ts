// lib/api.ts - Complete updated API client for Academic Research Agent backend

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  try {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `API Error: ${response.status}`);
    }

    const data = await response.json();
    return { data };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ==================== AUTH TYPES ====================

export interface LoginResponse {
  access_token: string;
  token_type: string;
  is_superuser: boolean;
  user_id: number;
}

export interface RegisterResponse {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  avatar?: string;
  created_at: string;
}

// ==================== AUTH API ====================

export const authApi = {
  login: async (
    email: string,
    password: string,
  ): Promise<ApiResponse<LoginResponse>> => {
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token")
          : null;

      // Backend uses OAuth2PasswordRequestForm which expects form data
      const formData = new URLSearchParams();
      formData.append("username", email); // OAuth2 uses 'username' field for email
      formData.append("password", password);

      const response = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `API Error: ${response.status}`);
      }

      const data = await response.json();
      return { data };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },

  register: async (
    firstName: string,
    lastName: string,
    email: string,
    password: string,
  ): Promise<ApiResponse<RegisterResponse>> => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `API Error: ${response.status}`);
      }

      const data = await response.json();
      return { data };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },

  logout: () => {
    // Client-side logout - just clear the token
    if (typeof window !== "undefined") {
      localStorage.removeItem("auth_token");
    }
    return Promise.resolve({ data: { success: true } });
  },

  me: () => fetchApi<User>("/auth/me"),

  validateToken: async (): Promise<boolean> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (!token) {
      return false;
    }
    // For now just check if token exists - backend will validate on API calls
    return true;
  },
};

// ==================== RESEARCH TYPES ====================

export enum ResearchMethod {
  LIBRARY_ONLY = "library_only",
  LLM_GENERAL = "llm_general",
  SUGGEST_BOOKS = "suggest_books",
  WEB_FALLBACK = "web_fallback",
  ALL = "all",
}

export interface ResearchQuery {
  query: string;
  method?: ResearchMethod;
  top_k?: number;
  start_date?: string | null;
}

export interface FilterInfo {
  applied: boolean;
  start_date: string;
  end_date: string;
  books_found: number;
  total_books_considered?: number;
}

export interface ResearchResult {
  id?: number;
  query: string;
  research_plan: string[];
  answer: string;
  sources: Array<{
    title: string;
    similarity: number;
    author?: string;
    file_path?: string;
    id?: number;
    date_published?: string;
  }>;
  provider_log: Array<{
    step: string;
    provider: string;
    model: string;
    timestamp?: number;
    filter?: string;
  }>;
  status: string;
  confidence: number;
  source_type: string; // 'library' | 'llm_general' | 'web' | 'suggestion' | 'none' | 'error'
  provider: string; // 'ollama' | 'openai' | 'anthropic' | 'github' | 'none'
  research_method: ResearchMethod;
  filter_info?: FilterInfo;
}

export interface ResearchSession {
  id: string;
  query: string;
  answer: string;
  sources: BookSearchResult[];
  research_plan?: string[];
  provider: string;
  confidence: number;
  research_method: string;
  source_type: "library" | "web" | "general" | "none" | "suggestion";
  created_at: string;
  filter_info?: FilterInfo;
}

// ==================== RESEARCH API ====================

export const researchApi = {
  /**
   * Perform research with selected method
   * @param query - Research question
   * @param topK - Number of sources to retrieve (1-10)
   * @param method - Research method to use (default: ALL)
   */
  query: (
    query: string,
    topK: number = 5,
    method: ResearchMethod = ResearchMethod.ALL,
    start_date?: Date | null,
    end_date?: Date | null, // Add end_date parameter
  ) =>
    fetchApi<ResearchResult>("/research/query", {
      method: "POST",
      body: JSON.stringify({
        query,
        top_k: topK,
        method: method,
        start_date: start_date ? start_date.toISOString() : null,
        end_date: end_date ? end_date.toISOString() : null, // Include end_date
      }),
    }),

  /**
   * Get a previous research session by ID
   */
  getSession: (sessionId: string) =>
    fetchApi<ResearchSession>(`/research/session/${sessionId}`),

  /**
   * Get research history for the current user
   */
  getHistory: () => fetchApi<ResearchSession[]>("/research/sessions"),
};

// ==================== BOOKS TYPES ====================

export interface Book {
  id: string;
  title: string;
  author?: string;
  file_path: string;
  file_size: number;
  date_published: Date;
  metadata?: Record<string, any>;
  indexed: boolean;
  indexed_at?: string;
  created_at: string;
}

export interface BookSearchResult {
  title: string;
  author?: string;
  similarity: number;
  date_published?: string;
  excerpt?: string;
  page?: number;
}

// export interface BookDetail extends Book {
//   content_preview?: string;
//   embedding_status: "indexed" | "pending";
// }

export interface BookDetail extends Book {
  content_preview: string;
  embedding_status: "indexed" | "pending" | "failed" | string;
  metadata_json: {
    filename?: string;
    extension?: string;
    size_bytes?: number;
    created?: number;
    modified?: number;
    [key: string]: any;
  };
}

export interface LibraryStats {
  total_books: number;
  indexed_books: number;
  pending_indexing: number;
  total_size_kb: number;
  unique_authors: number;
  top_authors: Array<{ name: string; count: number }>;
  indexing_progress: number;
}

// ==================== BOOKS API ====================

export const booksApi = {
  /**
   * List all books with pagination
   */
  list: () => fetchApi<{ books: Book[]; total: number }>(`/books/all?}`),

  /**
   * Get a single book by ID
   */
  get: (id: string) => fetchApi<BookDetail>(`/books/${id}`),

  /**
   * Upload a new PDF book with optional metadata
   */
  upload: async (
    file: File,
    title?: string,
    author?: string,
    datePublished?: string,
  ) => {
    console.log("Upload called with:", { title, author, datePublished });

    const formData = new FormData();
    formData.append("file", file);

    // Always append fields even if they're empty strings
    // The backend should handle empty values appropriately
    if (title !== undefined && title !== null) {
      console.log("Appending title:", title);
      formData.append("title", title);
    }

    if (author !== undefined && author !== null) {
      console.log("Appending author:", author);
      formData.append("author", author);
    }

    if (
      datePublished !== undefined &&
      datePublished !== null &&
      datePublished !== ""
    ) {
      try {
        // Handle different date formats
        let formattedDate = datePublished;

        // If it's a full ISO string, extract just the date part
        if (datePublished.includes("T")) {
          formattedDate = datePublished.split("T")[0];
        }

        // Validate the date
        const dateObj = new Date(formattedDate);
        if (!isNaN(dateObj.getTime())) {
          console.log("Appending date_published (formatted):", formattedDate);
          formData.append("date_published", formattedDate);
        } else {
          console.log("Invalid date format, sending as-is:", datePublished);
          formData.append("date_published", datePublished);
        }
      } catch (error) {
        console.log("Error formatting date, sending as-is:", datePublished);
        formData.append("date_published", datePublished);
      }
    }

    // Log FormData contents (for debugging)
    console.log("FormData entries:");
    for (let pair of formData.entries()) {
      console.log("  -", pair[0], ":", pair[1]);
    }

    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

    try {
      const response = await fetch(`${API_BASE_URL}/books/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Upload error response:", errorData);
        throw new Error(errorData.detail || "Upload failed");
      }

      const result = await response.json();
      console.log("Upload successful:", result);
      return result;
    } catch (error) {
      console.error("Upload fetch error:", error);
      throw error;
    }
  },

  /**
   * Update book metadata (Superuser only)
   */
  updateMetadata: async (
    bookId: string,
    title?: string,
    author?: string,
    datePublished?: string,
  ): Promise<{ data?: Book; error?: string }> => {
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token")
          : null;

      if (!token) {
        throw new Error("Not authenticated");
      }

      // Build query parameters - only include defined values
      const params = new URLSearchParams();

      if (title !== undefined && title !== null && title.trim() !== "") {
        params.append("title", title.trim());
      }

      if (author !== undefined && author !== null && author.trim() !== "") {
        params.append("author", author.trim());
      }

      if (
        datePublished !== undefined &&
        datePublished !== null &&
        datePublished !== ""
      ) {
        // Format date properly for the backend
        let formattedDate = datePublished;

        // If it's a full ISO string, extract just the date part
        if (datePublished.includes("T")) {
          formattedDate = datePublished.split("T")[0];
        }

        // Validate the date
        const dateObj = new Date(formattedDate);
        if (!isNaN(dateObj.getTime())) {
          // Format as YYYY-MM-DD which FastAPI's datetime can parse
          params.append("date_published", formattedDate);
        } else {
          console.log("Invalid date format, skipping date_published");
        }
      }

      // Only make the request if there are parameters to update
      if (params.toString() === "") {
        throw new Error("No metadata to update");
      }

      console.log(`Updating book ${bookId} with params:`, params.toString());

      const response = await fetch(
        `${API_BASE_URL}/books/${bookId}/metadata?${params.toString()}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            // REMOVE the Content-Type header since you're not sending JSON
            // "Content-Type": "application/json", // <- Remove this line
          },
        },
      );

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.detail || "Only superusers can update book metadata",
          );
        }
        if (response.status === 404) {
          throw new Error("Book not found");
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to update book metadata");
      }

      const data = await response.json();
      console.log("Update successful:", data);
      return { data };
    } catch (error) {
      console.error("Update metadata error:", error);
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },

  /**
   * Semantic search through books
   */
  search: (query: string, topK: number = 10, minSimilarity: number = 0.5) =>
    fetchApi<BookSearchResult[]>("/books/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        top_k: topK,
        min_similarity: minSimilarity,
      }),
    }),

  /**
   * Advanced search with multiple filters
   */
  advancedSearch: (params: {
    text_query?: string;
    author?: string;
    title_contains?: string;
    year_from?: number;
    year_to?: number;
    file_type?: string;
    min_size_mb?: number;
    max_size_mb?: number;
    has_embedding?: boolean;
    sort_by?: "relevance" | "date" | "title" | "size";
    sort_order?: "asc" | "desc";
  }) =>
    fetchApi<Book[]>("/books/advanced-search", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  /**
   * Reindex a specific book
   */
  reindex: (id: string) =>
    fetchApi<{ message: string }>(`/books/${id}/reindex`, { method: "POST" }),

  /**
   * Delete a book
   */
  delete: (id: string, deleteFile: boolean = true) =>
    fetchApi<{ message: string }>(`/books/${id}?delete_file=${deleteFile}`, {
      method: "DELETE",
    }),

  /**
   * Get library statistics
   */
  stats: () => fetchApi<LibraryStats>("/books/stats/summary"),

  /**
   * Get book recommendations based on ML clustering
   */
  getRecommendations: (id: string, limit: number = 5) =>
    fetchApi<BookDetail[]>(`/books/${id}/recommendations?limit=${limit}`),

  /**
   * Download a book file
   */
  download: async (id: string): Promise<void> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

    try {
      const response = await fetch(`${API_BASE_URL}/books/${id}/download`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      // if (!response.ok) {
      //   // Try to parse error as JSON, but don't fail if it's not JSON
      //   let errorMessage = "Download failed";
      //   try {
      //     const errorData = await response.json();
      //     errorMessage = errorData.detail || errorMessage;
      //   } catch {
      //     // If it's not JSON, use status text
      //     errorMessage = response.statusText || errorMessage;
      //   }
      //   throw new Error(errorMessage);
      // }

      // Check content type to ensure it's a PDF
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/pdf")) {
        console.warn("Unexpected content type:", contentType);
      }

      // Get the filename from Content-Disposition header or use a default
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = `book-${id}.pdf`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
        );
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, "");
        }
      }

      // Get the response as blob
      const blob = await response.blob();

      // Create a download link and trigger it
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;

      // Append to body, click, and remove
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
    }
  },

  /**
   * ML-enhanced search with popularity ranking
   */
  mlEnhancedSearch: async (
    query: string,
    topK: number = 10,
    minSimilarity: number = 0.5,
    usePopularityRanking: boolean = true,
    useRecommendations: boolean = false,
  ): Promise<{
    data?: Book[];
    error?: string;
  }> => {
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("auth_token")
          : null;

      const response = await fetch(
        `${API_BASE_URL}/books/search-ml-enhanced?use_popularity_ranking=${usePopularityRanking}&use_recommendations=${useRecommendations}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            query,
            top_k: topK,
            min_similarity: minSimilarity,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "ML-enhanced search failed");
      }

      const data = await response.json();
      return { data };
    } catch (error) {
      console.error("ML-enhanced search error:", error);
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
};

// ==================== HEALTH TYPES ====================

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  ollama_running: boolean;
  internet_accessible: boolean;
  books_count: number;
  database_connected: boolean;
}

// ==================== HEALTH API ====================

export const healthApi = {
  /**
   * Check system health
   */
  check: () => fetchApi<HealthStatus>("/health"),
};

// ==================== INDEXING TYPES ====================

export interface IndexingStatus {
  title: string;
  file_path: string;
  indexed: boolean;
  content_length?: number;
  error?: string;
}

export interface IndexTriggerResponse {
  message: string;
  books_queued: number;
  task_id: string;
  status: "processing" | "completed" | "failed";
}

// ==================== INDEXING API ====================

export const bulkImportApi = {
  /**
   * Start a bulk import from external sources
   */
  bulkImport: (data: {
    query: string;
    source: string;
    count: number;
    max_results: number;
    auto_start: boolean;
  }) =>
    fetchApi<{
      task_id: string;
      query: string;
      source: string;
      requested_count: number;
      status: string;
      message: string;
    }>("/bulk-imports/bulk-import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Get the status of a bulk import task
   */
  getStatus: (taskId: string) =>
    fetchApi<{
      task_id: string;
      status: string;
      total_found: number;
      imported_count: number;
      failed_count: number;
      books: any[];
      errors: string[];
      created_at: string;
      completed_at?: string;
    }>(`/bulk-imports/status/${taskId}`),
};

export const indexingApi = {
  /**
   * Trigger background indexing of all books (superuser only)
   */
  triggerIndexing: () =>
    fetchApi<IndexTriggerResponse>("/research/books/index", {
      method: "POST",
    }),

  /**
   * Get indexing status of all books
   */
  getStatus: () => fetchApi<IndexingStatus[]>("/research/books/index/status"),

  /**
   * Index a single book by filename (superuser only)
   */
  indexSingle: (filename: string, title?: string, author?: string) =>
    fetchApi<IndexingStatus>(
      `/research/books/index/${filename}?title=${title || ""}&author=${author || ""}`,
      {
        method: "POST",
      },
    ),
  /**
   * Reindex all unindexed books (superuser only)
   */
  reindexAllUnindexed: () =>
    fetchApi<{
      message: string;
      total_queued: number;
      local_books_queued: number;
      external_books_queued: number;
      failed_books?: Array<{ id: string; title: string; reason: string }>;
      total_failed?: number;
    }>("/books/reindex-all-unindexed", {
      method: "POST",
    }),
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Helper to get human-readable method name
 */
export function getMethodDisplayName(method: ResearchMethod): string {
  const displayNames: Record<ResearchMethod, string> = {
    [ResearchMethod.LIBRARY_ONLY]: "Library Only",
    [ResearchMethod.LLM_GENERAL]: "LLM General Knowledge",
    [ResearchMethod.SUGGEST_BOOKS]: "Suggest Books",
    [ResearchMethod.WEB_FALLBACK]: "Web Fallback",
    [ResearchMethod.ALL]: "Smart Selection (All)",
  };
  return displayNames[method] || method;
}

/**
 * Helper to get method icon name (for use with lucide-react)
 */
export function getMethodIconName(method: ResearchMethod): string {
  const icons: Record<ResearchMethod, string> = {
    [ResearchMethod.LIBRARY_ONLY]: "BookMarked",
    [ResearchMethod.LLM_GENERAL]: "Zap",
    [ResearchMethod.SUGGEST_BOOKS]: "Lightbulb",
    [ResearchMethod.WEB_FALLBACK]: "Globe",
    [ResearchMethod.ALL]: "Sparkles",
  };
  return icons[method] || "HelpCircle";
}

/**
 * Helper to get source type display name and color
 */
export function getSourceTypeInfo(sourceType: string): {
  label: string;
  color: string;
} {
  const types: Record<string, { label: string; color: string }> = {
    library: {
      label: "📚 Library",
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    },
    llm_general: {
      label: "🧠 General Knowledge",
      color:
        "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
    },
    web: {
      label: "🌐 Web Search",
      color:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    },
    suggestion: {
      label: "💡 Book Suggestions",
      color:
        "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
    },
    none: {
      label: "❌ No Sources",
      color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
    },
    error: {
      label: "⚠️ Error",
      color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    },
  };
  return (
    types[sourceType] || {
      label: sourceType,
      color: "bg-gray-100 text-gray-800",
    }
  );
}

/**
 * Helper to get provider display name
 */
export function getProviderDisplayName(provider: string): string {
  const providers: Record<string, string> = {
    ollama: "Ollama (Local)",
    openai: "OpenAI (Cloud)",
    anthropic: "Anthropic Claude",
    github: "GitHub Models (Free)",
    none: "No Provider",
  };
  return providers[provider] || provider;
}

// ==================== USERS TYPES ====================

export interface UpdateUserData {
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface ChangePasswordData {
  current_password: string;
  new_password: string;
}

// ==================== USERS API ====================

export const usersApi = {
  /**
   * Get all users (superuser only)
   */
  getAll: () => fetchApi<User[]>("/users/get_users"),

  /**
   * Get all superusers (superuser only)
   */
  getSuperusers: () => fetchApi<User[]>("/users/superusers"),

  /**
   * Get inactive users (superuser only)
   */
  getInactiveUsers: () => fetchApi<User[]>("/users/inactive_users"),

  /**
   * Get a single user by ID
   */
  get: (userId: number) => fetchApi<User>(`/users/${userId}`),

  /**
   * Update user details (superuser only)
   */
  update: (userId: number, data: UpdateUserData) =>
    fetchApi<User>(`/users/update/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  /**
   * Activate a user (superuser only)
   */
  activate: (userId: number) =>
    fetchApi<User>(`/users/activate/${userId}`, {
      method: "PATCH",
    }),

  /**
   * Deactivate a user (superuser only)
   */
  deactivate: (userId: number) =>
    fetchApi<User>(`/users/deactivate/${userId}`, {
      method: "PATCH",
    }),

  /**
   * Make a user superuser (superuser only)
   */
  makeSuperuser: (userId: number) =>
    fetchApi<{ message: string }>(`/users/make_user_superuser/${userId}`, {
      method: "PATCH",
    }),

  /**
   * Change current user's password
   */
  changePassword: (data: ChangePasswordData) =>
    fetchApi<{ message: string }>("/users/change-password", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// lib/api.ts - Add these types and methods

// Dashboard Types
export interface LibraryStats {
  total_books: number;
  total_size_kb: number;
  last_updated: string;
}

export interface DashboardOverview {
  library_stats: {
    total_books: number;
    indexed_books: number;
    pending_indexing: number;
    external_books: number;
    total_books_by_source: Record<string, number>;
    total_file_size_mb: number;
    avg_file_size_mb: number;
  };
  book_growth: Array<{
    date: string;
    count: number;
    cumulative: number;
  }>;
  indexing_progress: {
    indexed_percentage: number;
    pending_count: number;
    indexed_count: number;
  };
  popular_authors: Array<{
    author: string;
    book_count: number;
    indexed_count: number;
  }>;
  popular_subjects: Array<{
    subject: string;
    count: number;
  }>;
  publication_timeline: Array<{
    decade: string;
    book_count: number;
    indexed_count: number;
  }>;
  research_activity: {
    total_sessions: number;
    avg_confidence: number;
    sessions_last_30_days: number;
    most_used_providers: Record<string, number>;
    popular_research_methods: Record<string, number>;
  };
  model_metrics: Array<{
    model_name: string;
    model_type: string;
    accuracy?: number;
    f1_score?: number;
    mse?: number;
    training_time_seconds: number;
    predictions_count: number;
    last_used?: string;
  }>;
}

// Add dashboardApi
export const dashboardApi = {
  /**
   * Get comprehensive dashboard overview
   */
  getOverview: () => fetchApi<DashboardOverview>("/dashboard/overview"),

  /**
   * Get library insights and analytics
   */
  getLibraryInsights: () => fetchApi<any>("/dashboard/library/insights"),

  /**
   * Get research analytics
   */
  getResearchAnalytics: (days: number = 90) =>
    fetchApi<any>(`/dashboard/research/analytics?days=${days}`),

  /**
   * Get ML model performance metrics
   */
  getModelPerformance: () =>
    fetchApi<any[]>("/dashboard/ml/models/performance"),

  /**
   * Export dashboard stats
   */
  exportStats: (format: "json" | "csv" = "json") =>
    fetchApi<any>(`/dashboard/export/stats?format=${format}`),
};

// lib/api.ts - Add these methods to your existing mlApi object

export const mlApi = {
  /**
   * Train all ML models in background
   */
  trainModels: (modelType?: string) =>
    fetchApi<{ message: string; model_type?: string }>("/ml/train", {
      method: "POST",
      body: JSON.stringify({ model_type: modelType || null }),
    }),

  getDashboardStats: () => fetchApi<MLDashboardStats>("/ml/dashboard/stats"),

  listModels: (skip: number = 0, limit: number = 20, modelType?: string) => {
    let url = `/ml/models?skip=${skip}&limit=${limit}`;
    if (modelType) url += `&model_type=${modelType}`;
    return fetchApi<MLModel[]>(url);
  },

  getModelPerformance: (modelId: number) =>
    fetchApi<ModelPerformance>(`/ml/models/${modelId}/performance`),

  retrainModel: (modelId: number) =>
    fetchApi<{ message: string }>(`/ml/models/${modelId}/retrain`, {
      method: "POST",
    }),

  activateModel: (modelId: number) =>
    fetchApi<{ message: string; model_id: number }>(
      `/ml/models/${modelId}/activate`,
      { method: "POST" },
    ),
};

// Add these types
export interface MLDashboardStats {
  models: {
    total: number;
    ready: number;
    training: number;
  };
  predictions: {
    total: number;
    avg_time_ms: number;
  };
  recent_models: Array<{
    model_id: number;
    name: string;
    type: string;
    version: string;
    created_at: string;
    test_accuracy?: number;
    test_r2?: number;
    silhouette_score?: number;
  }>;
  most_used_models: Array<{
    name: string;
    predictions: number;
  }>;
}

export interface MLModel {
  id: number;
  name: string;
  model_type: string;
  algorithm: string;
  version: string;
  status: string;
  created_at: string;
  metrics: Array<{ name: string; value: number }>;
}

export interface ModelPerformance {
  model: {
    id: number;
    name: string;
    type: string;
    algorithm: string;
    version: string;
    created_at: string;
    status: string;
  };
  metrics: Array<{ name: string; value: number; fold: number | null }>;
  prediction_stats: {
    total_predictions: number;
    avg_prediction_time_ms: number;
  };
  training_data: Array<{
    type: string;
    sample_size: number;
    created_at: string;
  }>;
}
