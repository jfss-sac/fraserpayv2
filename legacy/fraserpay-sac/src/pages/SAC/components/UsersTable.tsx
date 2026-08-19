
import React, { useState } from 'react';
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, UserX, ChevronDown } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  student_number: string;
  role: string;
  tickets: number;
  points: number;
  qr_code?: string;
}

export interface UsersTableProps {
  users: User[];
  isLoading: boolean;
  searchTerm?: string;
  onSearchChange?: (value: string) => void;
  onUserSelect: (user: User) => void;
  onUserDelete?: (userId: string) => void;
}

const UsersTable: React.FC<UsersTableProps> = ({
  users,
  isLoading,
  searchTerm = "",
  onSearchChange = () => {},
  onUserSelect,
  onUserDelete
}) => {
  const [visibleCount, setVisibleCount] = useState(10);

  const handleDeleteClick = (event: React.MouseEvent, userId: string) => {
    event.stopPropagation(); // Prevent row click event
    if (onUserDelete) {
      onUserDelete(userId);
    }
  };

  const handleViewMore = () => {
    setVisibleCount(prev => prev + 10);
  };

  const displayedUsers = users.slice(0, visibleCount);
  const hasMore = users.length > visibleCount;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium">All Users</h3>
        <div className="w-64">
          <Input
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
      
      <Table>
        <TableCaption>All users in the system</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Student ID</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Points</TableHead>
            {onUserDelete && <TableHead className="w-[80px]">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={onUserDelete ? 6 : 5} className="text-center py-8">
                <div className="flex justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                </div>
              </TableCell>
            </TableRow>
          ) : displayedUsers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={onUserDelete ? 6 : 5} className="text-center py-8 text-muted-foreground">
                No users found
              </TableCell>
            </TableRow>
          ) : (
            displayedUsers.map((user) => (
              <TableRow 
                key={user.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onUserSelect(user)}
              >
                <TableCell className="font-medium">{user.name || 'N/A'}</TableCell>
                <TableCell>{user.email || 'N/A'}</TableCell>
                <TableCell>{user.student_number || 'N/A'}</TableCell>
                <TableCell className="capitalize">{user.role || 'student'}</TableCell>
                <TableCell className="text-right">
                  ${(user.tickets / 100).toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                    {user.points || 0}
                </TableCell>
                {onUserDelete && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDeleteClick(e, user.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete user"
                    >
                      <UserX className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      
      {hasMore && (
        <div className="flex justify-center mt-4">
          <Button 
            variant="outline" 
            onClick={handleViewMore}
            className="flex items-center gap-1"
          >
            View More
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default UsersTable;

