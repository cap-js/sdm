using { Attachments} from '@cap-js/attachments';
extend aspect Attachments with {
    folderId : String @title: 'Folder ID';
};
entity Chunks{
  ChunkID       : Int64;
  ID      : String;
  chunk  : LargeBinary;
}