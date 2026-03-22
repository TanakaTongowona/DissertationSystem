"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileText,
  Calendar,
  User,
  HardDrive,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  BookOpen,
  FileJson,
  Info,
  Sparkles,
  ChevronRight,
  TrendingUp,
  Link,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { booksApi, BookDetail } from "@/lib/api";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

// Helper function to safely format relative time
const formatRelativeTime = (dateString?: string | Date): string => {
  if (!dateString) return "Unknown";
  try {
    const date =
      typeof dateString === "string" ? new Date(dateString) : dateString;
    return formatDistanceToNow(date) + " ago";
  } catch (error) {
    return "Unknown date";
  }
};

// Helper function to safely format date
const safeFormatDate = (dateValue?: string | Date): string => {
  if (!dateValue) return "Unknown";
  try {
    const date =
      typeof dateValue === "string" ? new Date(dateValue) : dateValue;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (error) {
    return "Unknown";
  }
};

export default function BookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [recommendations, setRecommendations] = useState<BookDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRecommendations, setIsLoadingRecommendations] =
    useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<BookDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const bookId = params.id as string;

  useEffect(() => {
    loadBook();
    loadRecommendations();
  }, [bookId]);

  const loadBook = async () => {
    setIsLoading(true);
    setError(null);
    const { data, error } = await booksApi.get(bookId);
    if (error) {
      setError(error);
      toast.error("Failed to load book details");
    } else if (data) {
      setBook(data);
    }
    setIsLoading(false);
  };

  const loadRecommendations = async () => {
    setIsLoadingRecommendations(true);
    try {
      const { data, error } = await booksApi.getRecommendations(bookId, 5);
      if (!error && data) {
        setRecommendations(data);
      }
    } catch (error) {
      console.error("Failed to load recommendations:", error);
    } finally {
      setIsLoadingRecommendations(false);
    }
  };

  // Check if the book has a source (external source like google_books)
  const hasExternalSource = (): boolean => {
    if (!book) return false;
    // If there's a source field in metadata_json, it's from an external source
    return !!book.metadata_json?.source;
  };

  const handleDownload = async () => {
    if (!book) return;

    setIsDownloading(true);
    try {
      const response = await booksApi.download(book.id);
      toast.success("Download started successfully");
    } catch (error) {
      if (
        error instanceof Error &&
        !error.message.includes("Failed to fetch")
      ) {
        toast.error("Failed to download book");
      } else {
        toast.success("Download started successfully");
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleRecommendationClick = (recommendation: BookDetail) => {
    setSelectedRecommendation(recommendation);
    setDialogOpen(true);
  };

  const navigateToRecommendation = (id: string | number) => {
    setDialogOpen(false);
    router.push(`/books/${id}`);
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return "Unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatDate = (dateString?: string | Date): string => {
    if (!dateString) return "Unknown";
    try {
      const date =
        typeof dateString === "string" ? new Date(dateString) : dateString;
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      return "Unknown";
    }
  };

  const getEmbeddingStatusIcon = () => {
    if (!book) return null;

    switch (book.embedding_status) {
      case "indexed":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-amber-500" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getEmbeddingStatusColor = () => {
    if (!book) return "";

    switch (book.embedding_status) {
      case "indexed":
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
      case "pending":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
      case "failed":
        return "bg-destructive/10 text-destructive border-destructive/20";
      default:
        return "bg-muted/10 text-muted-foreground border-muted/20";
    }
  };

  const formatContentPreview = (content: string | undefined): string[] => {
    if (!content) return [];

    let preview = content;
    if (!expandedPreview && preview.endsWith("...")) {
      preview = preview.slice(0, -3);
    }

    const rawLines = preview
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const MIN_LINE_LENGTH = 60;
    const PARAGRAPH_END_CHARS = [".", "!", "?", ":", ";", '"', "'", ")", "]"];

    const paragraphs: string[] = [];
    let currentParagraph = "";

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      const lastChar = line[line.length - 1];
      const isEndOfParagraph = PARAGRAPH_END_CHARS.includes(lastChar);
      const isLongLine = line.length >= MIN_LINE_LENGTH;
      const nextLine = rawLines[i + 1]?.trim();
      const nextStartsWithLowercase = nextLine && /^[a-z]/.test(nextLine);

      if (currentParagraph) {
        if (currentParagraph.endsWith("-")) {
          currentParagraph = currentParagraph.slice(0, -1) + line;
        } else {
          currentParagraph += " " + line;
        }
      } else {
        currentParagraph = line;
      }

      const shouldBreak =
        isLongLine && isEndOfParagraph && !nextStartsWithLowercase;

      if (shouldBreak || i === rawLines.length - 1) {
        paragraphs.push(currentParagraph);
        currentParagraph = "";
      }
    }

    return paragraphs;
  };

  const RecommendationCard = ({ book }: { book: BookDetail }) => (
    <div
      className="group cursor-pointer p-4 rounded-xl border border-border/50 bg-card hover:bg-accent/5 hover:shadow-md transition-all duration-200"
      onClick={() => handleRecommendationClick(book)}
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors text-lg line-clamp-1">
                {book.title}
              </h4>
              {book.author && (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {book.author}
                </p>
              )}
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
            {book.date_published && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(book.date_published).getFullYear()}
              </span>
            )}
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {formatFileSize(book.file_size)}
            </span>
            <Badge
              variant="outline"
              className={`text-xs ${
                book.embedding_status === "indexed"
                  ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/30 text-amber-600 dark:text-amber-400"
              }`}
            >
              {book.embedding_status === "indexed" ? "Indexed" : "Pending"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container py-8 px-4 max-w-5xl mx-auto">
          <Button
            variant="ghost"
            className="mb-6 gap-2 hover:bg-muted/50 transition-colors"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Button>

          <div className="space-y-6">
            <div className="space-y-3">
              <Skeleton className="h-10 w-3/4" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>

            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container py-8 px-4 max-w-5xl mx-auto">
          <Button
            variant="ghost"
            className="mb-6 gap-2 hover:bg-muted/50 transition-colors"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Button>

          <Card className="border-destructive/20">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10 mb-4">
                <AlertCircle className="h-10 w-10 text-destructive" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Book Not Found
              </h2>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                {error ||
                  "The book you're looking for doesn't exist or you don't have permission to view it."}
              </p>
              <Button onClick={() => router.push("/library")} size="lg">
                Return to Library
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const previewParagraphs = formatContentPreview(book.content_preview);
  const hasLongPreview = previewParagraphs.length > 10 && !expandedPreview;
  const displayParagraphs = hasLongPreview
    ? previewParagraphs.slice(0, 10)
    : previewParagraphs;

  const isExternal = hasExternalSource();

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8 px-4 max-w-5xl mx-auto">
        {/* Header with navigation */}
        <div className="flex items-center justify-between mb-8">
          <Button
            variant="ghost"
            className="gap-2 hover:bg-muted/50 transition-colors"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Button>

          {/* Only show download button if the book has no external source */}
          {!isExternal && (
            <Button
              onClick={handleDownload}
              disabled={isDownloading}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all hover:shadow-md"
              size="lg"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isDownloading ? "Downloading..." : "Download PDF"}
            </Button>
          )}
        </div>

        {/* Hero Section with Book Info */}
        <div className="mb-8 bg-gradient-to-r from-primary/5 via-primary/5 to-transparent p-6 rounded-2xl border border-border/50">
          <div className="flex items-start gap-4">
            <div className="hidden sm:flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3 leading-tight">
                {book.title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
                {book.author && (
                  <div className="flex items-center gap-1.5 bg-muted/30 px-3 py-1 rounded-full">
                    <User className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">{book.author}</span>
                  </div>
                )}

                {book.date_published && (
                  <div className="flex items-center gap-1.5 bg-muted/30 px-3 py-1 rounded-full">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">
                      {formatDate(book.date_published)}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 bg-muted/30 px-3 py-1 rounded-full">
                  <HardDrive className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium">
                    {formatFileSize(book.file_size)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Badges Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <div
            className={`flex items-center gap-3 p-3 rounded-xl border ${getEmbeddingStatusColor()}`}
          >
            {getEmbeddingStatusIcon()}
            <div>
              <p className="text-xs text-muted-foreground">Indexing Status</p>
              <p className="text-sm font-medium capitalize">
                {book.embedding_status}
              </p>
            </div>
          </div>

          {book.metadata_json?.extension && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/10 border-muted/20">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">File Type</p>
                <p className="text-sm font-medium">
                  {book.metadata_json.extension.toUpperCase()}
                </p>
              </div>
            </div>
          )}

          {book.created_at && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/10 border-muted/20">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Added</p>
                <p className="text-sm font-medium">
                  {formatRelativeTime(book.created_at)}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/10 border-muted/20">
            <Info className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Book ID</p>
              <p className="text-sm font-medium font-mono">#{book.id}</p>
            </div>
          </div>
        </div>

        {/* Show external source notice if it has a source */}
        {isExternal && (
          <div className="mb-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  External Source
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  This book is from{" "}
                  {book.metadata_json?.source || "an external source"} and is
                  not stored locally.
                </p>
                {book.file_path && (
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      href={book.file_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View on{" "}
                      {book.metadata_json.source === "google_books"
                        ? "Google Books"
                        : "Source"}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Content and Metadata Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Content Preview - Takes 2/3 of the space */}
          <div className="lg:col-span-2">
            <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow h-full">
              <CardHeader className="border-b border-border/50 bg-muted/5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Content Preview
                </CardTitle>
                <CardDescription>
                  First {displayParagraphs.length} paragraphs of text from the
                  book
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {previewParagraphs.length > 0 ? (
                  <div className="space-y-4">
                    <div className="bg-muted/20 rounded-xl p-6 font-serif text-foreground/90 leading-relaxed border border-border/30">
                      {displayParagraphs.map((paragraph, index) => (
                        <p
                          key={index}
                          className="mb-4 last:mb-0 text-base leading-relaxed break-words text-justify"
                        >
                          {paragraph}
                        </p>
                      ))}

                      {hasLongPreview && (
                        <div className="mt-4 pt-4 border-t border-border/30">
                          <Button
                            variant="ghost"
                            onClick={() => setExpandedPreview(true)}
                            className="text-primary hover:text-primary/80 hover:bg-primary/5 w-full"
                          >
                            Show more ({previewParagraphs.length - 10} more
                            paragraphs)
                          </Button>
                        </div>
                      )}

                      {expandedPreview && (
                        <div className="mt-4 pt-4 border-t border-border/30">
                          <Button
                            variant="ghost"
                            onClick={() => setExpandedPreview(false)}
                            className="text-primary hover:text-primary/80 hover:bg-primary/5 w-full"
                          >
                            Show less
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
                      <span>• Text is joined naturally for easy reading</span>
                      <span>
                        • {previewParagraphs.length} paragraphs •{" "}
                        {book.content_preview?.length || 0} characters
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground bg-muted/10 rounded-xl">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No content preview available for this book</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Metadata Sidebar */}
          <div className="lg:col-span-1">
            {book.metadata_json &&
              Object.keys(book.metadata_json).length > 0 && (
                <Card className="border-border/50 shadow-sm h-full">
                  <CardHeader className="border-b border-border/50 bg-muted/5">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <FileJson className="h-5 w-5 text-primary" />
                      File Metadata
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <dl className="space-y-4">
                      {book.metadata_json.filename && (
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            Filename
                          </dt>
                          <dd className="text-sm font-mono bg-muted/30 p-2 rounded-lg break-all">
                            {book.metadata_json.filename}
                          </dd>
                        </div>
                      )}

                      {book.metadata_json.source && (
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-1">
                            Source
                          </dt>
                          <dd className="text-sm font-medium capitalize">
                            {book.metadata_json.source.replace("_", " ")}
                          </dd>
                        </div>
                      )}

                      {/* Display file_path (which contains info_url for external books) */}
                      {isExternal && book.file_path && (
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                            <Link className="h-3 w-3" />
                            File Path (URL)
                          </dt>
                          <dd className="text-sm break-all">
                            <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg">
                              <a
                                href={book.file_path}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 text-primary hover:underline truncate"
                              >
                                {book.file_path}
                              </a>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 flex-shrink-0"
                                onClick={() => handleCopyUrl(book.file_path!)}
                              >
                                {copiedUrl ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </dd>
                        </div>
                      )}

                      {book.metadata_json.extension && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground mb-1">
                              Extension
                            </dt>
                            <dd className="text-sm font-medium bg-muted/30 px-2 py-1 rounded inline-block">
                              {book.metadata_json.extension.toUpperCase()}
                            </dd>
                          </div>

                          {book.metadata_json.size_bytes && (
                            <div>
                              <dt className="text-xs font-medium text-muted-foreground mb-1">
                                Size
                              </dt>
                              <dd className="text-sm font-medium bg-muted/30 px-2 py-1 rounded inline-block">
                                {formatFileSize(book.metadata_json.size_bytes)}
                              </dd>
                            </div>
                          )}
                        </div>
                      )}

                      {book.metadata_json.created && (
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-1">
                            File Created
                          </dt>
                          <dd className="text-sm">
                            {new Date(
                              book.metadata_json.created * 1000,
                            ).toLocaleString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </dd>
                        </div>
                      )}

                      {book.metadata_json.modified && (
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-1">
                            Last Modified
                          </dt>
                          <dd className="text-sm">
                            {new Date(
                              book.metadata_json.modified * 1000,
                            ).toLocaleString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </CardContent>
                </Card>
              )}
          </div>
        </div>

        {/* Recommendations Section - Full Width Below */}
        <div className="mt-8">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="border-b border-border/50 bg-muted/5">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="h-5 w-5 text-primary" />
                    You Might Also Like
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Books similar to this one based on content analysis
                  </CardDescription>
                </div>
                {recommendations.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {recommendations.length} recommendations
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {isLoadingRecommendations ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl border border-border/50"
                    >
                      <div className="flex gap-4">
                        <Skeleton className="h-12 w-12 rounded-lg" />
                        <div className="flex-1">
                          <Skeleton className="h-5 w-3/4 mb-2" />
                          <Skeleton className="h-4 w-1/2 mb-2" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : recommendations.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {recommendations.map((rec) => (
                    <RecommendationCard key={rec.id} book={rec} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium">
                    No recommendations available yet
                  </p>
                  <p className="text-xs mt-1">
                    Train ML models to get personalized book recommendations
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recommendation Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {selectedRecommendation && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">
                  {selectedRecommendation.title}
                </DialogTitle>
                {selectedRecommendation.author && (
                  <DialogDescription className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4" />
                    by {selectedRecommendation.author}
                  </DialogDescription>
                )}
              </DialogHeader>

              <ScrollArea className="flex-1 pr-4">
                <div className="space-y-6">
                  {/* Book Info */}
                  <div className="grid grid-cols-2 gap-4 p-4 bg-muted/20 rounded-lg">
                    {selectedRecommendation.date_published && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Published
                        </p>
                        <p className="text-sm font-medium">
                          {safeFormatDate(
                            selectedRecommendation.date_published,
                          )}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        File Size
                      </p>
                      <p className="text-sm font-medium">
                        {formatFileSize(selectedRecommendation.file_size)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Status
                      </p>
                      <Badge
                        variant="outline"
                        className={
                          selectedRecommendation.embedding_status === "indexed"
                            ? "border-emerald-500/30 text-emerald-600"
                            : "border-amber-500/30 text-amber-600"
                        }
                      >
                        {selectedRecommendation.embedding_status === "indexed"
                          ? "✓ Indexed"
                          : "⌛ Pending"}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Added
                      </p>
                      <p className="text-sm font-medium">
                        {formatRelativeTime(selectedRecommendation.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Content Preview */}
                  {selectedRecommendation.content_preview && (
                    <div>
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-primary" />
                        Content Preview
                      </h3>
                      <div className="bg-muted/20 rounded-lg p-4 font-serif text-sm leading-relaxed max-h-64 overflow-y-auto">
                        {selectedRecommendation.content_preview}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons - Only show download if no source */}
                  <Separator />
                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={() =>
                        navigateToRecommendation(selectedRecommendation.id)
                      }
                      className="flex-1 gap-2"
                    >
                      <BookOpen className="h-4 w-4" />
                      View Full Details
                    </Button>
                    {!selectedRecommendation.metadata_json?.source && (
                      <Button
                        onClick={async () => {
                          try {
                            const bookId = String(selectedRecommendation.id);
                            await booksApi.download(bookId);
                            toast.success("Download started");
                          } catch (error) {
                            toast.error("Download failed");
                          }
                        }}
                        variant="outline"
                        className="flex-1 gap-2"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
