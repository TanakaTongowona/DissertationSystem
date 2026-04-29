"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Upload,
  Search,
  LayoutGrid,
  List,
  Filter,
  X,
  FileText,
  Loader2,
  AlertCircle,
  RefreshCw,
  BookOpen,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BookCard } from "@/components/book-card";
import { booksApi, Book } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { bulkImportApi, indexingApi } from "@/lib/api"; // Add these imports

type ViewMode = "grid" | "list";
type SortBy = "date" |"datecreated"| "title" | "size";
type FilterBy = "all" | "indexed" | "pending";

interface UploadingFile {
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
  bookId?: number;
  metadata?: {
    title?: string;
    author?: string;
    datePublished?: string;
  };
}

interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

interface UserData {
  user: User;
  isSuperuser: boolean;
}

interface EditingBook {
  id: string;
  title: string;
  author: string | null;
  datePublished: string | null;
}

interface BulkImportData {
  query: string;
  source: string;
  count: number;
  maxResults: number;
}

interface BulkImportTask {
  task_id: string;
  status: string;
  source?: string;
  total_found: number;
  imported_count: number;
  failed_count: number;
  books: any[];
  errors: string[];
}

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [filterBy, setFilterBy] = useState<FilterBy>("all");

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const router = useRouter();

  // Bulk import state
  const [isBulkImportModalOpen, setIsBulkImportModalOpen] = useState(false);
  const [bulkImportData, setBulkImportData] = useState<BulkImportData>({
    query: "",
    source: "google_books",
    count: 10,
    maxResults: 20,
  });
  const [isImporting, setIsImporting] = useState(false);
  const [importTask, setImportTask] = useState<BulkImportTask | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Reindex all state
  const [isReindexingAll, setIsReindexingAll] = useState(false);

  // Upload form state
  const [uploadFormData, setUploadFormData] = useState<{
    files: File[];
    title?: string;
    author?: string;
    datePublished?: string;
  }>({
    files: [],
    title: "",
    author: "",
    datePublished: "",
  });

  const [isMLSearchOpen, setIsMLSearchOpen] = useState(false);
  const [mlSearchQuery, setMlSearchQuery] = useState("");
  const [mlSearchResults, setMlSearchResults] = useState<Book[]>([]);
  const [isMLSearching, setIsMLSearching] = useState(false);
  const [mlSearchOptions, setMlSearchOptions] = useState({
    usePopularityRanking: true,
    useRecommendations: false,
    topK: 10,
    minSimilarity: 0.5,
  });

  const [deleteBookId, setDeleteBookId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit book state
  const [editingBook, setEditingBook] = useState<EditingBook | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Get user data from localStorage
  const [user, setUser] = useState<User | null>(null);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Load token from localStorage
    const authToken = localStorage.getItem("auth_token");
    setToken(authToken);

    // Load user data from localStorage
    const userDataStr = localStorage.getItem("user_data");
    if (userDataStr) {
      try {
        const userData: UserData = JSON.parse(userDataStr);
        setUser(userData.user);
        setIsSuperuser(
          userData.isSuperuser || userData.user?.is_superuser || false,
        );
      } catch (error) {
        console.error("Failed to parse user data:", error);
        setIsSuperuser(false);
      }
    }
  }, []);

  const loadBooks = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await booksApi.list();
    if (error) {
      toast.error("Failed to load books");
    } else if (data) {
      console.log("API Response:", data);
      setBooks(Array.isArray(data) ? data : data.books || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // Poll for bulk import status
  const pollImportStatus = useCallback(
    async (taskId: string) => {
      const pollInterval = setInterval(async () => {
        try {
          const { data, error } = await bulkImportApi.getStatus(taskId);
          if (error) {
            console.error("Failed to get import status:", error);
            clearInterval(pollInterval);
            setIsPolling(false);
            toast.error("Failed to get import status");
            return;
          }

          if (data) {
            setImportTask(data);

            if (data.status === "completed") {
              clearInterval(pollInterval);
              setIsPolling(false);
              toast.success(
                `Bulk import completed! Imported ${data.imported_count} books`,
              );
              loadBooks(); // Reload books list
            } else if (data.status === "failed") {
              clearInterval(pollInterval);
              setIsPolling(false);
              toast.error(`Bulk import failed: ${data.errors.join(", ")}`);
            }
          }
        } catch (error) {
          console.error("Error polling import status:", error);
          clearInterval(pollInterval);
          setIsPolling(false);
        }
      }, 2000);

      return () => clearInterval(pollInterval);
    },
    [loadBooks],
  );

  const handleMLSearch = async () => {
    if (!mlSearchQuery.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    setIsMLSearching(true);

    const { data, error } = await booksApi.mlEnhancedSearch(
      mlSearchQuery,
      mlSearchOptions.topK,
      mlSearchOptions.minSimilarity,
      mlSearchOptions.usePopularityRanking,
      mlSearchOptions.useRecommendations,
    );

    if (error) {
      toast.error(`Search failed: ${error}`);
      setMlSearchResults([]);
    } else if (data) {
      setMlSearchResults(data);
      toast.success(`Found ${data.length} results`);
    }

    setIsMLSearching(false);
  };

  const clearMLSearch = () => {
    setMlSearchQuery("");
    setMlSearchResults([]);
    setMlSearchOptions({
      usePopularityRanking: true,
      useRecommendations: false,
      topK: 10,
      minSimilarity: 0.5,
    });
  };

  // Filter and sort books
  const filteredBooks = (books || [])
    .filter((book) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          book.title.toLowerCase().includes(query) ||
          (book.author && book.author.toLowerCase().includes(query))
        );
      }
      return true;
    })
    .filter((book) => {
      if (filterBy === "indexed") return book.indexed;
      if (filterBy === "pending") return !book.indexed;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "title":
          return a.title.localeCompare(b.title);
        case "size":
          return (b.file_size || 0) - (a.file_size || 0);
        case "date":
        default:
          return (
            new Date(b.date_published || 0).getTime() -
            new Date(a.date_published || 0).getTime()
          );
        case "datecreated":
          return (
            new Date(b.created_at || 0).getTime() -
            new Date(a.created_at || 0).getTime()
          );
      }
    });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleViewBook = (bookId: string) => {
    router.push(`/books/${bookId}`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!isSuperuser) {
      toast.error("Only superusers can upload books");
      return;
    }

    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.type === "application/pdf",
    );

    if (files.length === 0) {
      toast.error("Please drop PDF files only");
      return;
    }

    setUploadFormData((prev) => ({
      ...prev,
      files: [...prev.files, ...files],
    }));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      if (!isSuperuser) {
        toast.error("Only superusers can upload books");
        return;
      }
      setUploadFormData((prev) => ({
        ...prev,
        files: [...prev.files, ...files],
      }));
    }
  };

  const removeFileFromUpload = (index: number) => {
    setUploadFormData((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
    }));
  };

  const handleUploadSubmit = async () => {
    if (uploadFormData.files.length === 0) {
      toast.error("Please select at least one file to upload");
      return;
    }

    const files = uploadFormData.files;

    // Create metadata object with the form values
    const metadata = {
      title: uploadFormData.title || undefined,
      author: uploadFormData.author || undefined,
      datePublished: uploadFormData.datePublished || undefined,
    };

    console.log("Upload metadata:", metadata); // Debug log

    const newUploads: UploadingFile[] = files.map((file) => ({
      file,
      progress: 0,
      status: "uploading" as const,
      metadata,
    }));

    setUploadingFiles((prev) => [...prev, ...newUploads]);

    // Close the modal and reset form
    setIsUploadModalOpen(false);
    setUploadFormData({ files: [], title: "", author: "", datePublished: "" });

    // Upload each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Use title from metadata if provided, otherwise extract from filename
        const titleToUse = metadata.title || file.name.replace(/\.pdf$/i, "");

        // Start progress simulation
        const progressInterval = setInterval(() => {
          setUploadingFiles((prev) =>
            prev.map((u) =>
              u.file === file && u.progress < 90
                ? { ...u, progress: u.progress + 5 }
                : u,
            ),
          );
        }, 200);

        try {
          // Upload with metadata
          console.log("Uploading file with metadata:", {
            title: titleToUse,
            author: metadata.author,
            datePublished: metadata.datePublished,
          });

          const uploadedBook = await booksApi.upload(
            file,
            titleToUse,
            metadata.author,
            metadata.datePublished,
          );

          clearInterval(progressInterval);

          setUploadingFiles((prev) =>
            prev.map((u) =>
              u.file === file
                ? {
                    ...u,
                    progress: 100,
                    status: "completed",
                    bookId: uploadedBook.id,
                  }
                : u,
            ),
          );

          toast.success(`Uploaded ${file.name}`);

          // Add the new book to the list immediately
          setBooks((prev) => [...prev, uploadedBook]);
        } catch (error) {
          clearInterval(progressInterval);
          throw error;
        }
      } catch (error) {
        console.error("Upload error:", error);
        setUploadingFiles((prev) =>
          prev.map((u) =>
            u.file === file
              ? {
                  ...u,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed",
                }
              : u,
          ),
        );
        toast.error(
          `Failed to upload ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // Reload books to get updated list with indexing status
    loadBooks();
  };

  const handleReindex = async (bookId: string) => {
    toast.info("Reindexing book...");
    const { error } = await booksApi.reindex(bookId);
    if (error) {
      toast.error("Failed to reindex book");
    } else {
      toast.success("Book reindexed successfully");
      loadBooks();
    }
  };

  const handleReindexAll = async () => {
    if (!isSuperuser) {
      toast.error("Only superusers can reindex all books");
      return;
    }

    setIsReindexingAll(true);
    toast.info("Starting reindexing of all unindexed books...");

    const { data, error } = await indexingApi.reindexAllUnindexed();

    if (error) {
      toast.error("Failed to start reindexing");
      console.error("Reindex all error:", error);
    } else if (data) {
      toast.success(
        `Reindexing started for ${data.total_queued} books ` +
          `(${data.local_books_queued} local, ${data.external_books_queued} external)`,
      );

      if (data.failed_books && data.failed_books.length > 0) {
        toast.warning(`${data.failed_books.length} books failed to queue`);
        console.warn("Failed books:", data.failed_books);
      }

      // Reload books after a delay to show updated indexing status
      setTimeout(() => {
        loadBooks();
      }, 3000);
    }

    setIsReindexingAll(false);
  };

  const handleBulkImport = async () => {
    if (!bulkImportData.query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    setIsImporting(true);

    const { data, error } = await bulkImportApi.bulkImport({
      query: bulkImportData.query,
      source: bulkImportData.source,
      count: bulkImportData.count,
      max_results: bulkImportData.maxResults,
      auto_start: true,
    });

    if (error) {
      toast.error("Failed to start bulk import");
      setIsImporting(false);
    } else if (data) {
      toast.success(`Bulk import started for "${data.query}"`);
      setIsBulkImportModalOpen(false);

      // Reset form
      setBulkImportData({
        query: "",
        source: "google_books",
        count: 10,
        maxResults: 20,
      });

      // Start polling for status
      setIsPolling(true);
      pollImportStatus(data.task_id);
    }

    setIsImporting(false);
  };

  const handleUpdateMetadata = async () => {
    if (!editingBook) return;

    setIsUpdating(true);
    const { error, data } = await booksApi.updateMetadata(
      editingBook.id,
      editingBook.title,
      editingBook.author || undefined,
      editingBook.datePublished || undefined,
    );

    if (error) {
      toast.error("Failed to update book metadata");
    } else {
      toast.success("Book metadata updated successfully");
      // Update the book in the local state
      setBooks((prev) =>
        prev.map((book) =>
          book.id === editingBook.id
            ? {
                ...book,
                title: editingBook.title,
                author: editingBook.author || undefined,
                date_published: editingBook.datePublished
                  ? new Date(editingBook.datePublished)
                  : book.date_published,
              }
            : book,
        ),
      );
      setEditingBook(null);
    }
    setIsUpdating(false);
  };

  const handleDelete = async () => {
    if (!deleteBookId) return;

    setIsDeleting(true);
    const { error } = await booksApi.delete(deleteBookId);
    if (error) {
      toast.error("Failed to delete book");
    } else {
      toast.success("Book deleted");
      setBooks((prev) => prev.filter((b) => b.id !== deleteBookId));
    }
    setIsDeleting(false);
    setDeleteBookId(null);
  };

  const clearCompletedUploads = () => {
    setUploadingFiles((prev) => prev.filter((u) => u.status === "uploading"));
  };

  const retryFailedUpload = (file: File) => {
    // Find the metadata for this file from the failed upload
    const failedUpload = uploadingFiles.find((u) => u.file === file);
    setUploadingFiles((prev) => prev.filter((u) => u.file !== file));

    // Re-upload with the same metadata
    const files = [file];
    const metadata = failedUpload?.metadata || {};

    const newUploads: UploadingFile[] = files.map((f) => ({
      file: f,
      progress: 0,
      status: "uploading" as const,
      metadata,
    }));

    setUploadingFiles((prev) => [...prev, ...newUploads]);

    // Trigger upload for this single file
    uploadSingleFile(file, metadata);
  };

  const uploadSingleFile = async (file: File, metadata: any) => {
    try {
      const titleToUse = metadata.title || file.name.replace(/\.pdf$/i, "");

      const progressInterval = setInterval(() => {
        setUploadingFiles((prev) =>
          prev.map((u) =>
            u.file === file && u.progress < 90
              ? { ...u, progress: u.progress + 5 }
              : u,
          ),
        );
      }, 200);

      try {
        const uploadedBook = await booksApi.upload(
          file,
          titleToUse,
          metadata.author,
          metadata.datePublished,
        );

        clearInterval(progressInterval);

        setUploadingFiles((prev) =>
          prev.map((u) =>
            u.file === file
              ? {
                  ...u,
                  progress: 100,
                  status: "completed",
                  bookId: uploadedBook.id,
                }
              : u,
          ),
        );

        toast.success(`Uploaded ${file.name}`);
        setBooks((prev) => [...prev, uploadedBook]);
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    } catch (error) {
      console.error("Upload error:", error);
      setUploadingFiles((prev) =>
        prev.map((u) =>
          u.file === file
            ? {
                ...u,
                status: "error",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : u,
        ),
      );
      toast.error(
        `Failed to upload ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  return (
    <div className="container py-8 px-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Your Academic Library
          </h1>
          <p className="text-muted-foreground">
            Manage your book collection ({books?.length} books)
            {isSuperuser && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                Superuser
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setIsMLSearchOpen(true)}
            className="gap-2"
          >
            <Search className="h-4 w-4" />
            Enhanced ML Search
          </Button>

          {/* Reindex All Button */}
          {isSuperuser && (
            <Button
              variant="outline"
              onClick={handleReindexAll}
              disabled={isReindexingAll}
              className="gap-2"
            >
              {isReindexingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Reindex All
            </Button>
          )}

          {/* Bulk Import Button */}
          {isSuperuser && (
            <Button
              variant="outline"
              onClick={() => setIsBulkImportModalOpen(true)}
              className="gap-2"
            >
              <Database className="h-4 w-4" />
              Bulk Import
            </Button>
          )}

          {/* Upload Button */}
          <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" disabled={!isSuperuser}>
                <Upload className="h-4 w-4" />
                Upload Books
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Upload Books</DialogTitle>
                <DialogDescription>
                  Upload PDF files to add to your library. They will be
                  automatically indexed.
                  {!isSuperuser && (
                    <p className="text-destructive mt-2 font-medium">
                      ⚠️ Only superusers can upload books.
                    </p>
                  )}
                </DialogDescription>
              </DialogHeader>

              {/* Optional Metadata Form */}
              {uploadFormData.files.length > 0 && (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <h4 className="font-medium text-sm">
                    Book Information (Optional)
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    This information will be applied to all uploaded files.
                    Leave blank to use filename as title.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">Title</Label>
                      <Input
                        id="title"
                        placeholder="e.g., Introduction to Machine Learning"
                        value={uploadFormData.title}
                        onChange={(e) =>
                          setUploadFormData((prev) => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="author">Author</Label>
                      <Input
                        id="author"
                        placeholder="e.g., John Doe"
                        value={uploadFormData.author}
                        onChange={(e) =>
                          setUploadFormData((prev) => ({
                            ...prev,
                            author: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="datePublished">Publication Date</Label>
                      <Input
                        id="datePublished"
                        type="date"
                        value={uploadFormData.datePublished}
                        onChange={(e) =>
                          setUploadFormData((prev) => ({
                            ...prev,
                            datePublished: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
                  !isSuperuser && "opacity-50 cursor-not-allowed bg-muted/50",
                )}
              >
                <FileText className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2">
                  {isSuperuser
                    ? "Drag and drop PDF files here, or"
                    : "You don't have permission to upload books"}
                </p>
                <label>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    disabled={!isSuperuser}
                  >
                    <span
                      className={cn(
                        "cursor-pointer",
                        !isSuperuser && "pointer-events-none opacity-50",
                      )}
                    >
                      {isSuperuser ? "Browse files" : "Upload disabled"}
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept=".pdf"
                    multiple
                    onChange={handleFileSelect}
                    className="sr-only"
                    disabled={!isSuperuser}
                  />
                </label>
              </div>

              {/* Selected Files List */}
              {uploadFormData.files.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Selected Files ({uploadFormData.files.length})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setUploadFormData({
                          files: [],
                          title: "",
                          author: "",
                          datePublished: "",
                        })
                      }
                    >
                      Clear all
                    </Button>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {uploadFormData.files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded-md"
                      >
                        <span className="truncate flex-1">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFileFromUpload(index)}
                          className="h-6 w-6 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload Actions */}
              {uploadFormData.files.length > 0 && (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setUploadFormData({
                        files: [],
                        title: "",
                        author: "",
                        datePublished: "",
                      })
                    }
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleUploadSubmit}>
                    Upload {uploadFormData.files.length} file(s)
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ML-Enhanced Search Dialog */}
      <Dialog
        open={isMLSearchOpen}
        onOpenChange={(open) => {
          setIsMLSearchOpen(open);
          if (!open) clearMLSearch();
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              ML-Enhanced Search
            </DialogTitle>
            <DialogDescription>
              Search with popularity ranking and AI-powered relevance scoring
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Search Input */}
            <div className="space-y-2">
              <Label htmlFor="ml-search">Search Query</Label>
              <div className="flex gap-2">
                <Input
                  id="ml-search"
                  placeholder="e.g., machine learning algorithms, quantum computing basics..."
                  value={mlSearchQuery}
                  onChange={(e) => setMlSearchQuery(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && !isMLSearching) {
                      handleMLSearch();
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  onClick={handleMLSearch}
                  disabled={isMLSearching || !mlSearchQuery.trim()}
                  className="gap-2"
                >
                  {isMLSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Search
                </Button>
              </div>
            </div>

            {/* Search Options */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Search Options
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="popularity-ranking"
                      checked={mlSearchOptions.usePopularityRanking}
                      onChange={(e) =>
                        setMlSearchOptions((prev) => ({
                          ...prev,
                          usePopularityRanking: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label
                      htmlFor="popularity-ranking"
                      className="text-sm cursor-pointer"
                    >
                      Use Popularity Ranking
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="recommendations"
                      checked={mlSearchOptions.useRecommendations}
                      onChange={(e) =>
                        setMlSearchOptions((prev) => ({
                          ...prev,
                          useRecommendations: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label
                      htmlFor="recommendations"
                      className="text-sm cursor-pointer"
                    >
                      Include Recommendations
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="top-k" className="text-sm">
                      Number of Results
                    </Label>
                    <Select
                      value={mlSearchOptions.topK.toString()}
                      onValueChange={(v) =>
                        setMlSearchOptions((prev) => ({
                          ...prev,
                          topK: parseInt(v),
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 results</SelectItem>
                        <SelectItem value="10">10 results</SelectItem>
                        <SelectItem value="20">20 results</SelectItem>
                        <SelectItem value="30">30 results</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="min-similarity" className="text-sm">
                      Minimum Similarity
                    </Label>
                    <Select
                      value={mlSearchOptions.minSimilarity.toString()}
                      onValueChange={(v) =>
                        setMlSearchOptions((prev) => ({
                          ...prev,
                          minSimilarity: parseFloat(v),
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.3">30% (Broader)</SelectItem>
                        <SelectItem value="0.5">50% (Balanced)</SelectItem>
                        <SelectItem value="0.7">70% (Stricter)</SelectItem>
                        <SelectItem value="0.9">90% (Very strict)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Search Results */}
            {mlSearchResults.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">
                    Search Results ({mlSearchResults.length})
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearMLSearch}
                    className="gap-1"
                  >
                    <X className="h-4 w-4" />
                    Clear
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2">
                  {mlSearchResults.map((book) => (
                    <Card
                      key={book.id}
                      className="hover:shadow-md transition-shadow"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-foreground truncate">
                              {book.title}
                            </h4>
                            {book.author && (
                              <p className="text-sm text-muted-foreground mt-1">
                                by {book.author}
                              </p>
                            )}
                            {book.date_published && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Published:{" "}
                                {new Date(
                                  book.date_published,
                                ).toLocaleDateString()}
                              </p>
                            )}
                          </div>

                          <div className="flex gap-1 ml-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                handleViewBook(book.id);
                                setIsMLSearchOpen(false);
                              }}
                              className="h-8 px-2"
                            >
                              View
                            </Button>
                            {isSuperuser && !book.indexed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  handleReindex(book.id);
                                  setIsMLSearchOpen(false);
                                }}
                                className="h-8 px-2"
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* No Results State */}
            {mlSearchQuery &&
              !isMLSearching &&
              mlSearchResults.length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="font-medium text-foreground mb-1">
                      No results found
                    </h3>
                    <p className="text-sm text-muted-foreground text-center">
                      Try adjusting your search query or lowering the similarity
                      threshold
                    </p>
                  </CardContent>
                </Card>
              )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Bulk Import Dialog */}
      <Dialog
        open={isBulkImportModalOpen}
        onOpenChange={setIsBulkImportModalOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Import Books</DialogTitle>
            <DialogDescription>
              Search for books from external sources and import them
              automatically. The import will run in the background.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="query">Search Query</Label>
              <Input
                id="query"
                placeholder="e.g., machine learning, quantum physics, etc."
                value={bulkImportData.query}
                onChange={(e) =>
                  setBulkImportData((prev) => ({
                    ...prev,
                    query: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Select
                value={bulkImportData.source}
                onValueChange={(v) =>
                  setBulkImportData((prev) => ({ ...prev, source: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google_books">Google Books</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="count">Number of Books to Import</Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={50}
                value={bulkImportData.count}
                onChange={(e) =>
                  setBulkImportData((prev) => ({
                    ...prev,
                    count: parseInt(e.target.value) || 10,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Maximum 50 books per import
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsBulkImportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleBulkImport} disabled={isImporting}>
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <BookOpen className="h-4 w-4 mr-2" />
                  Start Import
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search books..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={filterBy}
            onValueChange={(v) => setFilterBy(v as FilterBy)}
          >
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Books</SelectItem>
              <SelectItem value="indexed">Indexed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">By Publish Date</SelectItem>
              <SelectItem value="datecreated">By Upload Date</SelectItem>
              <SelectItem value="title">By Title</SelectItem>
              <SelectItem value="size">By Size</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex border border-border rounded-md">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("grid")}
              className="rounded-r-none"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
              className="rounded-l-none"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      {/* Books Grid/List */}
      {isLoading ? (
        <div
          className={cn(
            viewMode === "grid"
              ? "grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : "space-y-3",
          )}
        >
          {[...Array(8)].map((_, i) => (
            <Skeleton
              key={i}
              className={viewMode === "grid" ? "h-64" : "h-20"}
            />
          ))}
        </div>
      ) : filteredBooks.length > 0 ? (
        <div
          className={cn(
            viewMode === "grid"
              ? "grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : "space-y-3",
          )}
        >
          {filteredBooks.map((book) => (
            <BookCard
              key={book.id}
              id={book.id}
              title={book.title}
              author={book.author || "Unknown"}
              indexed={book.indexed}
              fileSize={book.file_size}
              datePublished={
                book.date_published
                  ? typeof book.date_published === "string"
                    ? book.date_published
                    : book.date_published.toISOString()
                  : undefined
              }
              variant={viewMode}
              isSuperuser={isSuperuser}
              onView={() => handleViewBook(book.id)}
              onReindex={() => handleReindex(book.id)}
              onUpdate={() => {
                setEditingBook({
                  id: book.id,
                  title: book.title,
                  author: book.author || null,
                  datePublished: book.date_published
                    ? typeof book.date_published === "string"
                      ? book.date_published
                      : book.date_published.toISOString().split("T")[0]
                    : null,
                });
              }}
              onDelete={() => setDeleteBookId(book.id)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium text-foreground mb-1">
              {searchQuery ? "No books found" : "No books yet"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
              {searchQuery
                ? "Try adjusting your search or filters"
                : "Upload a book to get started with research"}
            </p>
            {!searchQuery && isSuperuser && (
              <Button onClick={() => setIsUploadModalOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload a first book
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {/* Upload Progress Dialog */}
      <Dialog open={uploadingFiles.length > 0} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Progress</DialogTitle>
            <DialogDescription>
              Your files are being uploaded and indexed.
            </DialogDescription>
          </DialogHeader>

          {/* Upload Progress */}
          {uploadingFiles.length > 0 && (
            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Uploads</span>
                {uploadingFiles.some((u) => u.status !== "uploading") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearCompletedUploads}
                  >
                    Clear completed
                  </Button>
                )}
              </div>
              <div className="max-h-60 overflow-y-auto space-y-3">
                {uploadingFiles.map((upload, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate max-w-[200px]">
                        {upload.file.name}
                      </span>
                      <div className="flex items-center gap-2">
                        {upload.status === "uploading" && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                        {upload.status === "completed" && (
                          <span className="text-emerald-500">Done</span>
                        )}
                        {upload.status === "error" && (
                          <>
                            <span className="text-destructive flex items-center gap-1">
                              <AlertCircle className="h-4 w-4" />
                              Failed
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryFailedUpload(upload.file)}
                              className="h-6 px-2 text-xs"
                            >
                              Retry
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <Progress value={upload.progress} className="h-1" />
                    {upload.error && (
                      <p className="text-xs text-destructive mt-1">
                        {upload.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteBookId}
        onOpenChange={() => setDeleteBookId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Book</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this book? This action cannot be
              undone. The book will be removed from your library and its
              embeddings will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Edit Book Metadata Dialog */}
      <Dialog open={!!editingBook} onOpenChange={() => setEditingBook(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Book Metadata</DialogTitle>
            <DialogDescription>
              Update the book's title, author, or publication date.
            </DialogDescription>
          </DialogHeader>

          {editingBook && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  placeholder="Book title"
                  value={editingBook.title}
                  onChange={(e) =>
                    setEditingBook((prev) =>
                      prev ? { ...prev, title: e.target.value } : null,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-author">Author</Label>
                <Input
                  id="edit-author"
                  placeholder="Author name"
                  value={editingBook.author || ""}
                  onChange={(e) =>
                    setEditingBook((prev) =>
                      prev ? { ...prev, author: e.target.value } : null,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-datePublished">Publication Date</Label>
                <Input
                  id="edit-datePublished"
                  type="date"
                  value={editingBook.datePublished || ""}
                  onChange={(e) =>
                    setEditingBook((prev) =>
                      prev ? { ...prev, datePublished: e.target.value } : null,
                    )
                  }
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingBook(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateMetadata} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Import Status Dialog */}
      {isPolling && importTask && (
        <Dialog open={isPolling} onOpenChange={() => setIsPolling(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bulk Import Status</DialogTitle>
              <DialogDescription>
                Importing books from {importTask.source}...
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span>Status:</span>
                <span className="font-medium capitalize">
                  {importTask.status}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Progress:</span>
                <span>
                  {importTask.imported_count} / {importTask.total_found} books
                  imported
                </span>
              </div>
              <Progress
                value={
                  (importTask.imported_count / (importTask.total_found || 1)) *
                  100
                }
                className="h-2"
              />
              {importTask.errors.length > 0 && (
                <div className="text-sm text-destructive">
                  <p className="font-medium">Errors:</p>
                  <ul className="list-disc pl-4 mt-1">
                    {importTask.errors.slice(0, 3).map((error, i) => (
                      <li key={i} className="text-xs">
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button onClick={() => setIsPolling(false)} className="w-full">
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
