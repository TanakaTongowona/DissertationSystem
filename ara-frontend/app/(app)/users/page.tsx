"use client"

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users,
  Shield,
  ShieldCheck,
  UserCheck,
  UserX,
  Pencil,
  Search,
  Loader2,
  ChevronDown,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { usersApi, User } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function UsersPage() {
  const router = useRouter()
  const { user: currentUser, isSuperuser } = useAuth()
  
  const [users, setUsers] = useState<User[]>([])
  const [filteredUsers, setFilteredUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Edit user dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  
  // Confirmation dialog state
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'activate' | 'deactivate' | 'makeSuperuser'
    user: User
  } | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    const { data, error } = await usersApi.getAll()
    
    if (error) {
      toast.error(error)
      if (error.includes('403') || error.includes('not authorized')) {
        router.push('/dashboard')
      }
    } else if (data) {
      setUsers(data)
      setFilteredUsers(data)
    }
    setIsLoading(false)
  }, [router])

  useEffect(() => {
    if (!isSuperuser) {
      toast.error('You do not have permission to access this page')
      router.push('/dashboard')
      return
    }
    fetchUsers()
  }, [isSuperuser, router, fetchUsers])

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredUsers(users)
    } else {
      const query = searchQuery.toLowerCase()
      setFilteredUsers(
        users.filter(
          (user) =>
            user.email.toLowerCase().includes(query) ||
            user.first_name.toLowerCase().includes(query) ||
            user.last_name.toLowerCase().includes(query)
        )
      )
    }
  }, [searchQuery, users])

  const handleEditUser = (user: User) => {
    setEditingUser(user)
    setEditFirstName(user.first_name)
    setEditLastName(user.last_name)
    setEditEmail(user.email)
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    
    setIsUpdating(true)
    const { data, error } = await usersApi.update(editingUser.id, {
      first_name: editFirstName,
      last_name: editLastName,
      email: editEmail,
    })
    
    if (error) {
      toast.error(error)
    } else if (data) {
      toast.success('User updated successfully')
      setUsers((prev) =>
        prev.map((u) => (u.id === editingUser.id ? data : u))
      )
      setEditDialogOpen(false)
    }
    setIsUpdating(false)
  }

  const openConfirmDialog = (
    type: 'activate' | 'deactivate' | 'makeSuperuser',
    user: User
  ) => {
    setConfirmAction({ type, user })
    setConfirmDialogOpen(true)
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) return
    
    setIsConfirming(true)
    const { type, user } = confirmAction
    
    let result
    switch (type) {
      case 'activate':
        result = await usersApi.activate(user.id)
        break
      case 'deactivate':
        result = await usersApi.deactivate(user.id)
        break
      case 'makeSuperuser':
        result = await usersApi.makeSuperuser(user.id)
        break
    }
    
    if (result.error) {
      toast.error(result.error)
    } else {
      const messages = {
        activate: 'User activated successfully',
        deactivate: 'User deactivated successfully',
        makeSuperuser: 'User is now a superuser',
      }
      toast.success(messages[type])
      fetchUsers()
    }
    
    setIsConfirming(false)
    setConfirmDialogOpen(false)
    setConfirmAction(null)
  }

  const getInitials = (user: User) => {
    return `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
  }

  const getConfirmationContent = () => {
    if (!confirmAction) return { title: '', description: '' }
    
    const { type, user } = confirmAction
    const userName = `${user.first_name} ${user.last_name}`
    
    switch (type) {
      case 'activate':
        return {
          title: 'Activate User',
          description: `Are you sure you want to activate ${userName}? They will be able to log in and use the system.`,
        }
      case 'deactivate':
        return {
          title: 'Deactivate User',
          description: `Are you sure you want to deactivate ${userName}? They will no longer be able to log in.`,
        }
      case 'makeSuperuser':
        return {
          title: 'Make Superuser',
          description: `Are you sure you want to make ${userName} a superuser? They will have full administrative access.`,
        }
      default:
        return { title: '', description: '' }
    }
  }

  if (!isSuperuser) {
    return null
  }

  return (
    <div className="container py-8 px-4 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
          <Users className="h-8 w-8" />
          User Management
        </h1>
        <p className="text-muted-foreground">
          Manage users, permissions, and account status
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Users</CardDescription>
            <CardTitle className="text-2xl">{users.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Users</CardDescription>
            <CardTitle className="text-2xl text-emerald-600">
              {users.filter((u) => u.is_active).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Inactive Users</CardDescription>
            <CardTitle className="text-2xl text-amber-600">
              {users.filter((u) => !u.is_active).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Superusers</CardDescription>
            <CardTitle className="text-2xl text-blue-600">
              {users.filter((u) => u.is_superuser).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Search and Filter */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" onClick={fetchUsers} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Refresh'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mb-4" />
              <p>No users found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar} alt={`${user.first_name} ${user.last_name}`} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(user)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {user.first_name} {user.last_name}
                          </p>
                          {user.id === currentUser?.id && (
                            <span className="text-xs text-muted-foreground">(You)</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.is_active ? 'default' : 'secondary'}
                        className={cn(
                          user.is_active
                            ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                        )}
                      >
                        {user.is_active ? (
                          <>
                            <UserCheck className="h-3 w-3 mr-1" />
                            Active
                          </>
                        ) : (
                          <>
                            <UserX className="h-3 w-3 mr-1" />
                            Inactive
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.is_superuser ? (
                        <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Superuser
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <Shield className="h-3 w-3 mr-1" />
                          User
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            Actions
                            <ChevronDown className="h-4 w-4 ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditUser(user)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {user.is_active ? (
                            <DropdownMenuItem
                              onClick={() => openConfirmDialog('deactivate', user)}
                              className="text-amber-600"
                              disabled={user.id === currentUser?.id}
                            >
                              <UserX className="h-4 w-4 mr-2" />
                              Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => openConfirmDialog('activate', user)}
                              className="text-emerald-600"
                            >
                              <UserCheck className="h-4 w-4 mr-2" />
                              Activate
                            </DropdownMenuItem>
                          )}
                          {!user.is_superuser && (
                            <DropdownMenuItem
                              onClick={() => openConfirmDialog('makeSuperuser', user)}
                              className="text-blue-600"
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" />
                              Make Superuser
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information for {editingUser?.first_name} {editingUser?.last_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getConfirmationContent().title}</AlertDialogTitle>
            <AlertDialogDescription>
              {getConfirmationContent().description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirming}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction} disabled={isConfirming}>
              {isConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Confirm'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
